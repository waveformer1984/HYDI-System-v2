# Switchboard Mobile UI Guide

## Supported Viewports

Switchboard is built mobile-first and supports:

- 320px (small phones)
- 600px (large phones / small tablets)
- 900px+ (tablets and desktops)

Breakpoints:

```css
@media (min-width: 600px) { ... }
@media (min-width: 900px) { ... }
```

## Shared Assets

- `public/styles.css` — shared mobile-first styles
- `public/ui.js` — shared helpers (`SB.request`, `SB.loading`, `SB.error`, `SB.success`, `SB.statusBadge`, `SB.formatDate`)

## Navigation

- A `header` with `h1` and a menu toggle button is used on all pages.
- The `Menu` button toggles `nav.open` on small screens.
- On 600px+ screens, the menu is always visible as a horizontal bar.
- Every primary view has a `Back` link when it is a standalone utility page.

## Conventions

### Cards

All content blocks are wrapped in `.card`:

```html
<div class="card">
  <h2>Title</h2>
  ...
</div>
```

### Forms

Each field is a `.field` with a `<label>` and one input:

```html
<div class="field">
  <label for="email">Email</label>
  <input id="email" type="email" />
</div>
```

### Feedback

Use `SB.loading`, `SB.error`, `SB.success`, `SB.empty` to communicate state instead of `alert()`.

### Buttons

- Primary action: default `<button>`
- Secondary: `<button class="secondary">`
- Danger: `<button class="danger">`
- Warning: `<button class="warning">`
- Success: `<button class="success">`

### Badges

Use `SB.statusBadge(status)` for status labels. They automatically pick a semantic color.

## Accessibility

- Inputs always have `<label>` or `aria-label`.
- Buttons have a minimum touch size of 44x44px.
- `role` and `aria-live` are used for dynamic regions.
- Focus states are visible with a 2px primary outline.

## Responsive Tips

- Avoid fixed widths.
- Use `flex` and `grid` with `1fr` columns that collapse on small screens.
- Wrap tables in a `.table-wrap` with `overflow-x: auto` if the table can exceed the viewport.
- Test by resizing the browser to 320px before committing frontend changes.
