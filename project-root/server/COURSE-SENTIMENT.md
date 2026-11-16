# TensorFlow.js sentiment middleware course example

This standalone Express example serves a real, pre-trained English IMDB sentiment CNN. It does not train a model, download model files at server startup, or fall back to synthetic predictions.

## 1. Prepare and start the API

Run the model-download cell in `MERN_AI_Setup.ipynb` first. It places the model JSON, metadata, and weight shards in `server/models/pretrained-sentiment-v1/`. The server expects that directory beside `server/src`; a missing or inconsistent artifact stops startup before the port is bound.

From `project-root/server`, start the local API:

```sh
node src/sentiment-api.cjs
```

It listens on `127.0.0.1:3003`. Override the port with `PORT=3013 node src/sentiment-api.cjs`. Health checks return ready only after the model has loaded, passed architecture checks, and completed a finite-score warmup:

```sh
curl http://127.0.0.1:3003/healthz
```

The API is loopback-only for local learning. Do not expose it directly to the internet; a deployed service needs HTTPS, authentication, rate limiting, and operational resource limits. TensorFlow.js native CPU inference runs synchronously and can block the Node event loop; production workloads should isolate or queue inference appropriately.

## 2. Follow the middleware flow

`src/sentiment-model.cjs` reads `metadata.json` and loads the already-downloaded `model.json` and weights once through `@tensorflow/tfjs-node`. It verifies the 100-token input contract, one sigmoid output, and that the embedding size matches the vocabulary metadata. The encoder lowercases text, removes periods/commas/exclamation marks, splits repeated whitespace, maps words to the IMDB indices, and maps unknown or out-of-model-vocabulary words to OOV index `2`. It keeps the last 100 tokens and pre-pads with `0`. It intentionally does not prepend a START token.

`src/sentiment-api.cjs` wires Express middleware in this order:

1. Require `application/json`, then parse strict UTF-8 JSON with decompression disabled and an 8 KB body limit.
2. Accept exactly `{ "text": "..." }`, with 1–2,000 characters.
3. Run the inference middleware, which stores the classification on `res.locals`, and format it in the final route handler.

The response contract is:

```json
{
  "model": "imdb-sentiment-cnn-v1",
  "label": "positive",
  "score": 0.91,
  "threshold": 0.5,
  "tokenCount": 8,
  "oovCount": 0,
  "truncated": false
}
```

`score` is the model's sigmoid output, not a calibrated confidence or accuracy estimate. `positive` is selected at scores greater than or equal to `0.5`; otherwise the label is `negative`. There is no neutral class. Requests containing only punctuation or only out-of-vocabulary words receive `422`, rather than a fabricated classification. Input text is not included in responses or server error logs.

## 3. Exercise it with Postman or tests

Import `server/postman/sentiment.postman_collection.json` in Postman. Set its `baseUrl` collection variable to `http://127.0.0.1:3003` (or the chosen port), then run the collection. Positive and negative review examples deliberately assert response structure and threshold consistency, not a promised label for a particular sentence.

The focused automated suite uses Node's built-in test runner and `fetch`:

```sh
node src/sentiment-api.test.cjs
```

The direct command above was verified in the notebook: 12 passing tests (11 subtests plus their parent), zero failures, and the temporary API closed afterward. The standard runner entry point is also available:

```sh
node --test src/sentiment-api.test.cjs
```

It exercises preprocessing, readiness, prediction response shape, validation and parser errors, OOV behavior, 404s, repeated-inference tensor cleanup, and missing-artifact startup failure.

The tests use one enclosing async test: it registers cleanup before startup, awaits model startup, and then awaits each subtest sequentially. This explicit lifecycle fixes HTTP tests running before startup had assigned the API handle. Requests have 5-second deadlines, subtests 15-second deadlines, and the enclosing test a 60-second deadline. Shutdown gives active connections 2 seconds before closing them and disposing the model.

The notebook also verified the collection through Newman: 9 requests, 9 assertions, zero failures. These are contract checks, not model-accuracy measurements. Newman 6 is a development dependency, used only with this collection's trusted local examples. The npm audit report after installation listed **23 findings: 6 moderate, 15 high, and 2 critical**. They were not remediated; these results do not imply that the dependency tree is safe for production. Review advisories before reuse and do not execute untrusted collections.

For startup troubleshooting, use `SENTIMENT_DIAGNOSTICS=1 node --test src/sentiment-api.test.cjs`. Static stderr markers distinguish model loading and native warmup without logging input. Notebook subprocess wrappers should still enforce their outer timeout and terminate the entire spawned process group, including any test-worker child. Surface both stdout and stderr on failure.

## Model provenance and limits

The model and tokenizer metadata are from TensorFlow.js Examples' sentiment project: [tensorflow/tfjs-examples — sentiment](https://github.com/tensorflow/tfjs-examples/tree/master/sentiment). Review that project and its [Apache 2.0 license](https://github.com/tensorflow/tfjs-examples/blob/master/LICENSE) when redistributing its model artifacts. The example uses an IMDB movie-review sentiment model, so it may be unreliable for other domains, sarcasm, short snippets, mixed-language text, or words outside its fixed vocabulary. No accuracy or fairness guarantee is made by this course service.
