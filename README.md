# brimbles.github.io

My personal site. Plain HTML/CSS, hosted on GitHub Pages.

## Structure

```
├── index.html          ← homepage (auto-generated project listing)
├── posts/              ← generated HTML posts (don't edit by hand)
├── drafts/             ← write your posts here in markdown
├── assets/images/      ← post images go here
├── styles.css          ← site styling
└── build.py            ← converts drafts to HTML
```

## Adding a new post

1. Create a `.md` file in `drafts/`:

```markdown
---
title: My Project Title
date: 2024-06-15
summary: One-line description shown on the index page
---

Write your post content here using markdown.

## Headings

Regular paragraphs, **bold**, *italic*, and [links](https://example.com).

- list items
- work like this

![alt text](assets/images/my-project/photo.jpg)
```

2. Put any images in `assets/images/your-project-name/`

3. Run the build:

```
uv run python build.py
```

This generates `posts/your-file.html` and rebuilds `index.html`.

4. Commit and push. GitHub Pages serves it automatically.

## Requirements

- [uv](https://docs.astral.sh/uv/) with Python 3.6+ (no external packages needed)

## Supported markdown

The build script handles the basics:

- `## Heading` → section headings
- `**bold**` and `*italic*`
- `[text](url)` → links
- `![alt](path)` → images
- `- item` → unordered lists
- Paragraphs (separated by blank lines)

For anything fancier, just write the HTML directly in the markdown file — it passes through as-is.
