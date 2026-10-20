import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(fileURLToPath(import.meta.url));
const { handleBoardRequest } = require('../lib/forge-board/http.js');

export default function handler(req, res) {
  return handleBoardRequest(req, res);
}
