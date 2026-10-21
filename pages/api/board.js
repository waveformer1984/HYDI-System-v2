import path from 'path';

// Next's production bundle replaces a non-literal createRequire call with
// undefined, and the compiled route has no real module URL for a relative
// require. Ask Node for its own loader and require the handler from the
// repo root at runtime.
function loadHandler() {
  const root = process.cwd();
  const { createRequire } = process.getBuiltinModule('module');
  const nodeRequire = createRequire(path.join(root, 'package.json'));
  return nodeRequire(path.join(root, 'lib', 'forge-board', 'http.js')).handleBoardRequest;
}

export default function handler(req, res) {
  return loadHandler()(req, res);
}
