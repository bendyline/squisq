import { handleMarkdownParseRequest } from '../markdownParseProtocol.js';

globalThis.onmessage = ({ data }) => {
  const result = handleMarkdownParseRequest(data);
  if (result) globalThis.postMessage(result);
};
