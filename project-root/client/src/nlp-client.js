import axios from 'axios';
import { useEffect, useState } from 'react';

export const nlpApi = axios.create({ baseURL: '/nlp', timeout: 8000 });

export function nlpError(error) {
  if (typeof error.response?.data?.error === 'string') return error.response.data.error;
  if (error.code === 'ECONNABORTED') return 'The local NLP request timed out. Try again.';
  if (axios.isAxiosError(error)) return 'Cannot reach the local NLP service. Start server/src/text-api.cjs and try again.';
  return error.message;
}

export function useNlpQuery(path, field, text, validate) {
  const [state, setState] = useState({ result: null, pending: false, error: '' });
  useEffect(() => {
    if (!text.trim()) {
      setState({ result: null, pending: false, error: '' });
      return;
    }
    let current = true;
    const controller = new AbortController();
    setState({ result: null, pending: true, error: '' });
    // Debounce reduces requests; cancellation AND the identity guard protect against stale replies.
    const timer = setTimeout(async () => {
      try {
        const { data } = await nlpApi.post(path, { [field]: text }, { signal: controller.signal });
        if (!validate(data)) throw new Error('The local NLP service returned an unexpected response.');
        if (current) setState({ result: data, pending: false, error: '' });
      } catch (error) {
        if (current) setState({ result: null, pending: false, error: nlpError(error) });
      }
    }, 300);
    return () => {
      current = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [path, field, text, validate]);
  return state;
}
