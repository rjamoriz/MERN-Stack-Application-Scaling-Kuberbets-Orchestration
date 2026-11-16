'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const tls = require('node:tls');
const { execFileSync, spawn } = require('node:child_process');

const TRUST_ERRORS = new Set([
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_UNTRUSTED',
]);

function labError(code) {
  const error = new Error('Security lab failed.');
  error.name = 'SecurityLabError';
  error.code = code;
  return error;
}

function safeFailure(error, stage) {
  const safe = labError(
    typeof error?.code === 'number' ||
      /^[A-Z][A-Z0-9_]{0,63}$/.test(String(error?.code ?? ''))
      ? error.code
      : 'LAB_FAILED',
  );
  safe.name = /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(String(error?.name ?? ''))
    ? error.name
    : 'Error';
  safe.stage = stage;
  return safe;
}

function executable(name) {
  const candidates = [
    `/usr/local/bin/${name}`,
    ...(process.env.PATH || '').split(path.delimiter).filter(Boolean)
      .map((directory) => path.resolve(directory, name)),
  ];
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // Check the next installed executable; never install system packages.
    }
  }
  throw labError(`MISSING_${name.toUpperCase()}`);
}

function privateFile(filename, contents) {
  fs.writeFileSync(filename, contents, { mode: 0o600, flag: 'wx' });
}

function createCertificates(directory, openssl) {
  const caKey = path.join(directory, 'ca.key');
  const ca = path.join(directory, 'ca.crt');
  const serverKey = path.join(directory, 'server.key');
  const request = path.join(directory, 'server.csr');
  const certificate = path.join(directory, 'server.crt');
  const pem = path.join(directory, 'server.pem');
  const caConfig = path.join(directory, 'ca.cnf');
  const leafConfig = path.join(directory, 'server.cnf');
  privateFile(caConfig, [
    '[req]', 'prompt = no', 'distinguished_name = dn',
    'x509_extensions = ca_ext', '[dn]', 'CN = Isolated Course Lab CA',
    '[ca_ext]', 'basicConstraints = critical,CA:true',
    'keyUsage = critical,keyCertSign,cRLSign', 'subjectKeyIdentifier = hash', '',
  ].join('\n'));
  privateFile(leafConfig, [
    '[req]', 'prompt = no', 'distinguished_name = dn', '[dn]',
    'CN = localhost', '[leaf_ext]', 'basicConstraints = critical,CA:false',
    'keyUsage = critical,digitalSignature,keyEncipherment,keyAgreement',
    'extendedKeyUsage = serverAuth,clientAuth',
    'subjectAltName = DNS:localhost,IP:127.0.0.1',
    'subjectKeyIdentifier = hash', 'authorityKeyIdentifier = keyid,issuer', '',
  ].join('\n'));

  // Pre-create private outputs: OpenSSL must not briefly create world-readable keys.
  for (const filename of [caKey, ca, serverKey, request, certificate]) {
    privateFile(filename, '');
  }
  const run = (args) => execFileSync(openssl, args, {
    stdio: 'ignore', timeout: 8_000,
  });
  run(['req', '-new', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-days', '2', '-sha256', '-config', caConfig, '-keyout', caKey, '-out', ca]);
  run(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256',
    '-config', leafConfig, '-keyout', serverKey, '-out', request]);
  run(['x509', '-req', '-in', request, '-CA', ca, '-CAkey', caKey,
    '-set_serial', `0x${crypto.randomBytes(16).toString('hex')}`,
    '-days', '2', '-sha256', '-extfile', leafConfig, '-extensions', 'leaf_ext',
    '-out', certificate]);
  privateFile(pem, Buffer.concat([
    fs.readFileSync(serverKey), Buffer.from('\n'), fs.readFileSync(certificate),
  ]));
  return { ca, pem };
}

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) =>
    error ? reject(error) : resolve()));
  return port;
}

function tlsProbe(port, ca) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: '127.0.0.1', port, servername: 'localhost',
      minVersion: 'TLSv1.2', rejectUnauthorized: true,
      // An empty trust store tests rejection independently of machine CA settings.
      ca: ca ? fs.readFileSync(ca) : [],
    });
    const finish = (error, result) => {
      socket.destroy();
      if (error) reject(error);
      else resolve(result);
    };
    socket.setTimeout(2_000, () => finish(labError('TLS_PROBE_TIMEOUT')));
    socket.once('error', (error) => finish(error));
    socket.once('secureConnect', () => {
      if (!socket.authorized) return finish(labError('TLS_NOT_AUTHORIZED'));
      finish(null, { protocol: socket.getProtocol(), cipher: socket.getCipher().name });
    });
  });
}

function startMongod(mongod, config) {
  // No shell, fork, daemon, or detached process: this exact handle owns the lab.
  const child = spawn(mongod, ['--config', config], {
    stdio: 'ignore', detached: false,
  });
  const state = { child, done: false, outcome: null };
  state.closed = new Promise((resolve) => {
    child.once('error', (error) => { state.spawnError = error; });
    child.once('close', (code, signal) => {
      state.done = true;
      state.outcome = { code, signal };
      resolve(state.outcome);
    });
  });
  return state;
}

async function waitReady(state, port, ca) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (state.spawnError) throw state.spawnError;
    if (state.done) {
      // The released ephemeral port can race another binder. Never reuse its DB.
      throw labError(state.outcome.code === 48 ? 'PORT_BIND_RACE' : 'MONGOD_EXITED');
    }
    try {
      const result = await tlsProbe(port, ca);
      if (state.done || state.spawnError) throw labError('MONGOD_EXITED');
      return result;
    } catch (error) {
      // A foreign listener cannot pass validation against this fresh private CA.
      if (!['ECONNREFUSED', 'ECONNRESET', 'TLS_PROBE_TIMEOUT'].includes(error.code)) {
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw labError('STARTUP_TIMEOUT');
}

async function stopMongod(state) {
  if (!state) return true;
  if (!state.done && state.child.pid) state.child.kill('SIGTERM');
  let timer;
  const completed = await Promise.race([
    state.closed.then(() => true),
    new Promise((resolve) => { timer = setTimeout(() => resolve(false), 15_000); }),
  ]);
  clearTimeout(timer);
  if (!completed) {
    // Escalate only this owned child if graceful shutdown cannot complete.
    state.child.kill('SIGKILL');
    await state.closed;
    throw labError('SHUTDOWN_TIMEOUT');
  }
  if (state.child.pid && state.outcome.code !== 0 &&
      state.outcome.signal !== 'SIGTERM') {
    throw labError('MONGOD_ABNORMAL_EXIT');
  }
  return true;
}

async function expectMongoCode(operation, code) {
  try {
    await operation();
  } catch (error) {
    if (error.code === code) return true;
    throw error;
  }
  throw labError('EXPECTED_DENIAL_NOT_OBSERVED');
}

async function runSecurityLab() {
  let stage = 'dependencies';
  let processState;
  let masterKey;
  let report;
  let failure;
  const cleanupFailures = [];
  const clients = [];
  const encryptors = [];
  let deadlineExpired = false;
  // Interrupt outstanding network work by stopping only our child; finally still
  // closes clients and verifies exit before any result is returned.
  const deadlineTimer = setTimeout(() => {
    deadlineExpired = true;
    if (processState?.child.pid && !processState.done) {
      processState.child.kill('SIGTERM');
    }
  }, 70_000);
  const maxTimeMS = 3_000;
  try {
    // Explicit CSFLE works on Community; no autoEncryption or helper daemon.
    const { MongoClient, ClientEncryption, Binary } = require('mongodb');
    const mongod = executable('mongod');
    const openssl = executable('openssl');
    stage = 'private-artifacts';
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mern-security-lab-'));
    fs.chmodSync(directory, 0o700);
    const dbPath = path.join(directory, 'db');
    fs.mkdirSync(dbPath, { mode: 0o700 });
    const { ca, pem } = createCertificates(directory, openssl);
    masterKey = crypto.randomBytes(96);
    privateFile(path.join(directory, 'local-master-key.bin'), masterKey);
    const port = await availablePort();
    const logPath = path.join(directory, 'mongod.log');
    privateFile(logPath, '');
    const configPath = path.join(directory, 'mongod.json');
    // JSON is a YAML subset, so paths are escaped safely for mongod's config parser.
    privateFile(configPath, JSON.stringify({
      storage: { dbPath, engine: 'wiredTiger' },
      systemLog: { destination: 'file', path: logPath, logAppend: true },
      net: {
        bindIp: '127.0.0.1', port,
        tls: {
          mode: 'requireTLS', certificateKeyFile: pem, CAFile: ca,
          disabledProtocols: 'TLS1_0,TLS1_1',
          // Allows SCRAM without a CLIENT cert, NOT invalid certificate acceptance.
          allowConnectionsWithoutCertificates: true,
        },
      },
      security: { authorization: 'enabled' },
    }, null, 2));
    stage = 'startup';
    if (deadlineExpired) throw labError('LAB_DEADLINE');
    processState = startMongod(mongod, configPath);
    const negotiated = await waitReady(processState, port, ca);
    const uri = `mongodb://127.0.0.1:${port}/?directConnection=true`;
    const client = (auth, authSource = 'admin') => {
      const instance = new MongoClient(uri, {
        tls: true, tlsCAFile: ca, minPoolSize: 0, maxPoolSize: 2,
        serverSelectionTimeoutMS: 3_000, connectTimeoutMS: 2_000,
        socketTimeoutMS: 5_000, retryReads: false, retryWrites: false,
        ...(auth ? { auth, authSource, authMechanism: 'SCRAM-SHA-256' } : {}),
      });
      clients.push(instance);
      return instance;
    };
    const credentials = () => ({
      username: crypto.randomBytes(16).toString('hex'),
      password: crypto.randomBytes(32).toString('base64url'),
    });
    const rootAuth = credentials();
    const appAuth = credentials();
    const readerAuth = credentials();
    stage = 'bootstrap';
    const bootstrap = client();
    await bootstrap.connect();
    // Fresh dbPath + unique TLS CA identify OUR instance before localhost bootstrap.
    await bootstrap.db('admin').command({
      createUser: rootAuth.username, pwd: rootAuth.password,
      mechanisms: ['SCRAM-SHA-256'], roles: [{ role: 'root', db: 'admin' }],
      maxTimeMS,
    });
    await bootstrap.close();
    const admin = client(rootAuth);
    await admin.connect();
    const options = (await admin.db('admin').command({ getCmdLineOpts: 1, maxTimeMS })).parsed;
    assert.equal(options.storage.dbPath, dbPath);
    assert.equal(options.net.bindIp, '127.0.0.1');
    assert.equal(options.net.port, port);
    assert.equal(options.net.tls.mode, 'requireTLS');
    assert.equal(options.security.authorization, 'enabled');
    assert.equal(options.security.enableEncryption, undefined);
    const status = await admin.db('admin').command({ serverStatus: 1, maxTimeMS });
    assert.equal(status.storageEngine.name, 'wiredTiger');
    const build = await admin.db('admin').command({ buildInfo: 1, maxTimeMS });
    assert.ok(!build.modules.includes('enterprise'));

    stage = 'roles-and-key-vault';
    const profilesResource = { db: 'lab_db', collection: 'profiles' };
    const vaultResource = { db: 'encryption', collection: '__keyVault' };
    const roleDefinitions = [
      { db: 'lab_db', role: 'appWriter',
        privileges: [{ resource: profilesResource, actions: ['find', 'insert', 'update'] }] },
      { db: 'lab_db', role: 'analystReader',
        privileges: [{ resource: profilesResource, actions: ['find'] }] },
      // Non-admin custom roles grant privileges only within their own database.
      { db: 'encryption', role: 'labKeyReader',
        privileges: [{ resource: vaultResource, actions: ['find'] }] },
    ];
    await admin.db('lab_db').createCollection('profiles', { maxTimeMS });
    await admin.db('encryption').createCollection('__keyVault', { maxTimeMS });
    await admin.db('encryption').collection('__keyVault').createIndex(
      { keyAltNames: 1 },
      { unique: true, partialFilterExpression: { keyAltNames: { $exists: true } }, maxTimeMS },
    );
    for (const definition of roleDefinitions) {
      await admin.db(definition.db).command({
        createRole: definition.role, privileges: definition.privileges, roles: [], maxTimeMS,
      });
    }
    for (const [auth, roles] of [
      [appAuth, [{ role: 'appWriter', db: 'lab_db' },
        { role: 'labKeyReader', db: 'encryption' }]],
      [readerAuth, [{ role: 'analystReader', db: 'lab_db' }]],
    ]) {
      await admin.db('lab_db').command({
        createUser: auth.username, pwd: auth.password,
        mechanisms: ['SCRAM-SHA-256'], roles, maxTimeMS,
      });
    }
    // Local KMS is instructional, NOT recommended production key management.
    // DB roles alone do not authorize decryption: wrapped DEK + KMS access are needed.
    const encryption = (mongoClient) => {
      const instance = new ClientEncryption(mongoClient, {
        keyVaultNamespace: 'encryption.__keyVault',
        kmsProviders: { local: { key: masterKey } },
      });
      encryptors.push(instance);
      return instance;
    };
    const adminEncryption = encryption(admin);
    const keyId = await adminEncryption.createDataKey('local');
    const app = client(appAuth, 'lab_db');
    const reader = client(readerAuth, 'lab_db');
    await app.connect();
    await reader.connect();
    const appEncryption = encryption(app);

    stage = 'explicit-csfle-and-allowed-operations';
    const original = 'synthetic course preference';
    const encrypted = await appEncryption.encrypt(original, {
      keyId, algorithm: 'AEAD_AES_256_CBC_HMAC_SHA_512-Random',
    });
    // A key-holding app can bypass explicit encryption; schema/policy controls
    // and separation of duties are additional defenses, not supplied by this lab.
    const appProfiles = app.db('lab_db').collection('profiles');
    const inserted = await appProfiles.insertOne(
      { protectedPreference: encrypted, visits: 1 }, { maxTimeMS },
    );
    const updated = await appProfiles.updateOne(
      { _id: inserted.insertedId }, { $inc: { visits: 1 } }, { maxTimeMS },
    );
    assert.equal(updated.modifiedCount, 1);
    const appRecord = await appProfiles.findOne({ _id: inserted.insertedId }, { maxTimeMS });
    assert.equal(appRecord.visits, 2);
    // Plain reader has no ClientEncryption object or KMS provider.
    const readerRecord = await reader.db('lab_db').collection('profiles')
      .findOne({ _id: inserted.insertedId }, { maxTimeMS });
    assert.ok(readerRecord.protectedPreference instanceof Binary);
    assert.equal(readerRecord.protectedPreference.sub_type, 6);
    const roundTrip = await appEncryption.decrypt(appRecord.protectedPreference);
    assert.equal(roundTrip, original);

    stage = 'denied-operations';
    const unauthenticated = client();
    await unauthenticated.connect();
    const denied = {
      unauthenticatedFind: await expectMongoCode(() =>
        unauthenticated.db('lab_db').collection('profiles').findOne({}, { maxTimeMS }), 13),
      wrongPassword: await expectMongoCode(() =>
        client({ username: appAuth.username,
          password: crypto.randomBytes(32).toString('base64url') }, 'lab_db').connect(), 18),
      readerInsert: await expectMongoCode(() =>
        reader.db('lab_db').collection('profiles').insertOne({ visits: 0 }, { maxTimeMS }), 13),
      appUnrelatedFind: await expectMongoCode(() =>
        app.db('lab_db').collection('unrelated').findOne({}, { maxTimeMS }), 13),
      readerKeyVaultFind: await expectMongoCode(() =>
        reader.db('encryption').collection('__keyVault').findOne({}, { maxTimeMS }), 13),
    };
    stage = 'tls-negative-probe';
    let untrustedRejected = false;
    try {
      await tlsProbe(port);
    } catch (error) {
      if (!TRUST_ERRORS.has(error.code)) throw error;
      untrustedRejected = true;
    }
    assert.equal(untrustedRejected, true);
    assert.ok(['TLSv1.2', 'TLSv1.3'].includes(negotiated.protocol));
    report = {
      labDirectory: directory,
      isolation: { loopbackOnly: true, freshDatabase: true, artifactsRetained: true },
      tls: { mode: 'requireTLS', minimum: 'TLSv1.2', ...negotiated,
        authorized: true, untrustedRejected, scramWithoutClientCertificate: true },
      authorizationEnabled: true,
      roles: roleDefinitions,
      allowed: { appInsert: true, appUpdate: true, appFind: true, readerFind: true },
      denied,
      csfle: { explicit: true, localKmsLabOnly: true, storedBsonSubtype: 6, roundTrip: true },
      storage: { engine: 'wiredTiger', nativeEncryptionEnabled: false,
        communityEncryptedStorageEngineSupported: false },
      counts: { inserted: 1, updated: updated.modifiedCount, denialChecks: 5 },
      labStopped: false,
    };
  } catch (error) {
    failure = safeFailure(error, stage);
  } finally {
    // Driver 6 ClientEncryption has no public close/dispose API and borrows its
    // MongoClient. Release our references; close every owning client below.
    encryptors.length = 0;
    const clientResults = await Promise.allSettled(clients.map((item) =>
      Promise.resolve().then(() => item.close())));
    for (const [index, result] of clientResults.entries()) {
      if (result.status === 'rejected') {
        cleanupFailures.push(safeFailure(result.reason, `cleanup-client-${index + 1}`));
      }
    }
    clients.length = 0;
    try {
      const stopped = await stopMongod(processState);
      if (report) report.labStopped = stopped;
    } catch (error) {
      cleanupFailures.push(safeFailure(error, 'shutdown'));
    }
    masterKey?.fill(0);
    clearTimeout(deadlineTimer);
    if (deadlineExpired) failure ||= safeFailure(labError('LAB_DEADLINE'), 'deadline');
  }
  // Keep the original operation's stage/name/code as the primary failure.
  // Cleanup errors remain individually visible, even when the main run failed.
  failure ||= cleanupFailures[0];
  if (failure && cleanupFailures.length) {
    failure.cleanupFailures = cleanupFailures.map(({ stage: failedStage, name, code }) =>
      ({ stage: failedStage, name, code }));
  }
  if (failure) throw failure;
  return report;
}

module.exports = { runSecurityLab };

if (require.main === module) {
  runSecurityLab().then(
    (report) => console.log(JSON.stringify(report, null, 2)),
    (error) => {
      const safe = safeFailure(error, error.stage || 'unknown');
      console.error(JSON.stringify({
        stage: safe.stage, name: safe.name, code: safe.code,
        ...(error.cleanupFailures ? { cleanupFailures: error.cleanupFailures } : {}),
      }));
      process.exitCode = 1;
    },
  );
}
