const { handleBoardRequest } = require('../../lib/forge-board/http.js');

export default function handler(req, res) {
    return handleBoardRequest(req, res);
}
