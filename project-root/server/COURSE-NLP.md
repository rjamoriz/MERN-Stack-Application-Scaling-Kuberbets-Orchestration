# Local English course NLP

This educational backend is independent of the house-price API. It uses no hosted
models, secrets, database, request persistence, embeddings, or semantic reasoning.
Send only non-sensitive English course text. Input is not language-detected.

`src/course-nlp.cjs` exports:

- `predictText(text)`: `{model: 'count-based-ngram', contextLength, suggestions}`.
  Suggestions contain `{word, text, probability, count}`. Thirty literal,
  hand-authored sentences (`COURSE_SENTENCES`) train once on module load.
  Missing/duplicate entries fail training; `getCorpusReport()` returns sentence,
  token, vocabulary, duplicate, and missing counts. One/two-word contexts use
  longest-match backoff. Punctuation (`.!?;:`) and newlines reset sentence context.
  Standalone partial words can use unigram vocabulary completion; unknown
  contexts otherwise return no suggestions. A final word without whitespace is
  treated as a partial token, so use `"react "` for next-word prediction.
  Original text before the partial token is preserved exactly; the replacement
  token is lowercase and completed text ends with a space.
  Probabilities normalize **all** matching counts before returning the top three.
  They are empirical frequencies, not calibrated confidence estimates.
- `recommendText(query)`: `{model: 'tfidf-cosine', items}` with up to three
  `{id, title, score, matchedTerms}` results. Six frozen `LEARNING_RESOURCES`
  cover React, API, TensorFlow, clustering, persistence and privacy.
  Natural's WordTokenizer is explicitly lowercased (it does not lowercase by
  itself). Stopwords are explicit in source; there is no stemming. Raw term counts
  use Natural 8.2.6's IDF: `1 + ln(N / (1 + df))`. IDF is fitted only on the fixed
  catalogue. Query OOV terms are ignored; all-OOV queries return `[]`.
  Cosine-normalized scores are in `(0, 1]`; zero matches are excluded.
- `converse(message, context = null)`: `{intent, reply, context}`. Deterministic
  greeting, help, recommendation, reset and unknown rules; **not a generative
  LLM**. `"recommend a lesson"` returns `context: "awaiting-topic"`; send that
  context with `"react"` for the next turn. No server-side conversation storage.

`src/text-api.cjs` exports async `startTextApi({port = 3002} = {})`, resolving to
`{baseUrl, close()}`. `close()` returns a Promise. Port `0` chooses an ephemeral
port. Running `node src/text-api.cjs` listens only on `127.0.0.1:3002`; SIGINT or
SIGTERM closes it. No CORS is enabled: use a local frontend development proxy.

Routes:

| Route | Request |
|---|---|
| `GET /healthz` | none |
| `POST /complete` | `{"text":"we learn re"}` |
| `POST /recommend` | `{"query":"react hooks"}` |
| `POST /converse` | `{"message":"recommend a lesson","context":null}` |

JSON bodies must be uncompressed UTF-8 `application/json`, at most 1 KB, with
exactly the documented keys. Text fields are strings of 1–500 characters;
completion accepts whitespace (empty suggestions). Only conversation `context`
is optional and must be `null` or `"awaiting-topic"`. Errors: 400 malformed/schema,
413 oversized, 415 unsupported media/encoding, 404 unknown route, 500 unexpected
failure (logged without request text).

Natural 8.2.6 is pinned; its declared Node engine accepts Node 22.1.0.
Tokenizer and TF-IDF deep imports avoid Natural's eager all-features entrypoint.
Installation uses `npm install --ignore-scripts` to avoid rerunning unrelated
TensorFlow native installation scripts.

Validation belongs in the course notebook. From a notebook code cell, run
`node --test src/course-nlp.test.cjs src/text-api.test.cjs` with this server
directory as the working directory. HTTP tests use ephemeral ports and close
their servers. Follow that code cell with a markdown analysis of results.
