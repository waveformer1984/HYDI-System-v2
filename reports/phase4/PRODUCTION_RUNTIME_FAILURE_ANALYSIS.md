# Production Runtime Failure Analysis

## Failure

```text
npm start
```

served a 500 error for every page:

```text
TypeError: (0 , react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV) is not a function
    at App (webpack-internal:///(pages-dir-node)/./pages/_app.tsx:12:87)
```

`__NEXT_DATA__.buildId` was `"development"`.

## Environment

* Next.js: `15.5.22`
* React: installed locally via `react` / `react-dom` (19.x compatible with Next 15)
* `package.json` `start`: `next start`
* `.env` does not pin `NODE_ENV` (commented out to avoid breaking `next dev`)

## Mechanism

1. `next dev` writes development bundles into `.next` using the React JSX dev runtime.
2. `next start` serves whatever is in `.next` without rebuilding.
3. If `next start` is invoked after `next dev`, it serves the dev bundle.
4. The dev bundle imports `react/jsx-dev-runtime` and calls `jsxDEV`.
5. When `NODE_ENV` is production, `react/jsx-dev-runtime` resolves to `cjs/react-jsx-dev-runtime.production.min.js`, which contains `exports.jsxDEV = void 0`.
6. Calling `void 0` as a function throws `jsxDEV is not a function`.

## Evidence

* `curl http://127.0.0.1:3000/photo-forge` before rebuild returned 500 with `buildId: "development"`.
* `next build` produced `buildId: DGmz97GWul-kj5Gd1C077`.
* `next start` after `next build` served the same page with `buildId: DGmz97GWul-kj5Gd1C077` and HTTP 200.

## Conclusion

The failure was a stale build artifact, not a source-level bug, dependency incompatibility, or Photo Forge regression. The correction is to ensure `next start` always runs against a fresh production build by adding `prestart: npm run build` to `package.json`.
