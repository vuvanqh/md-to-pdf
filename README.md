# MD to PDF

A static web app that shows Markdown the way the [yzane Markdown PDF](https://github.com/yzane/vscode-markdown-pdf) VS Code extension prints it, as live A4 pages, before you export anything.

- **Live preview, paginated.** It uses the extension's own CSS (`markdown.css`, `tomorrow.css`, `markdown-pdf.css`), markdown-it with the same options, GitHub-style heading anchors and its default margins. Paged.js lays the content out as real pages.
- **Page breaks.** `<div style="page-break-after: always;"></div>`, `page-break-before` and `<div class="page"></div>` all start a new page.
- **Outline.** Click a heading to jump to it in both the editor and the preview. Click anything in the preview to jump to its source line. **Ctrl+J** scrolls the preview to the cursor.
- **Header and footer.** Each band has left, center and right slots. A slot can show the file name, the first heading, the date, page numbers or custom text. Custom text can include the placeholders `{page}`, `{pages}`, `{date}`, `{file}` and `{title}`.
- **Download.** This uses the browser's print engine, which is the same Chromium engine yzane uses. Choose "Save as PDF" in the print dialog.
- **Stateless.** Nothing is stored or uploaded. Images are matched by file name from a folder you pick.

## Run locally

Open `index.html` directly, or serve the folder:

```sh
python -m http.server 8000
```

## Deploy to GitHub Pages

Push this folder to a repository. Then go to **Settings → Pages → Deploy from branch** and choose `main` with the `/ (root)` folder.
