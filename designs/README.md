# RootTracer — UI Design References

**Approved style:** Concept A — Clear Overview  
**Canva design:** https://www.canva.com/design/DAHbqCjuNsQ/edit

## Product designs

- [RootTracer-Complete-UI.html](product/RootTracer-Complete-UI.html): complete 17-page editable design source.
- [RootTracer-UI-Handoff.json](product/RootTracer-UI-Handoff.json): colors, typography, component inventory, screen routes, interaction and responsive notes.
- Seventeen individual HTML files, one per finalized screen or design page.

## Design sources

- [build-roottracer-product.mjs](source/build-roottracer-product.mjs): shared design primitives, app shell, navigation, fields, cards, tables, charts, code viewers and initial screens.
- [roottracer-product-part2.js](source/roottracer-product-part2.js): remaining screens, user flow and design system.
- [assemble-product.mjs](source/assemble-product.mjs): rebuilds the final HTML files and handoff JSON.

Rebuild from the workspace root:

```sh
node designs/source/assemble-product.mjs
```

These are static HTML/CSS design sources and editable Canva designs. They are not implemented React components or a connected application. The handoff JSON describes component names and behavior for frontend work. No package installation is required to regenerate the files.
