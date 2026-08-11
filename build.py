#!/usr/bin/env python3
"""
build.py - Converts markdown files in /drafts to HTML posts and rebuilds index.html
Usage: python build.py
No external dependencies - uses only the Python standard library.
"""

import os
import re
from pathlib import Path

ROOT_DIR = Path(__file__).parent
DRAFTS_DIR = ROOT_DIR / "drafts"
POSTS_DIR = ROOT_DIR / "posts"


def parse_frontmatter(content):
    """Extract YAML-like frontmatter and body from markdown content."""
    match = re.match(r"^---\s*\n(.*?)\n---\s*\n(.*)$", content, re.DOTALL)
    if not match:
        return {}, content

    meta = {}
    for line in match.group(1).splitlines():
        m = re.match(r"^(\w+):\s*(.+)$", line.strip())
        if m:
            meta[m.group(1)] = m.group(2).strip()

    return meta, match.group(2)


def convert_inline(text):
    """Convert inline markdown (bold, italic, links, inline images)."""
    # Bold
    text = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", text)
    # Italic
    text = re.sub(r"\*([^*]+)\*", r"<em>\1</em>", text)
    # Images inline
    text = re.sub(r"!\[([^\]]*)\]\(([^)]+)\)", r'<img src="../\2" alt="\1">', text)
    # Links
    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', text)
    return text


def convert_markdown(body):
    """Convert markdown body to HTML."""
    lines = body.splitlines()
    html_parts = []
    in_list = False

    for line in lines:
        # Close list if line is not a list item
        if in_list and not re.match(r"^\s*-\s+", line):
            html_parts.append("</ul>")
            in_list = False

        # Heading ##
        m = re.match(r"^## (.+)$", line)
        if m:
            html_parts.append(f"<h3>{convert_inline(m.group(1))}</h3>")
            continue

        # Image on its own line
        m = re.match(r"^!\[([^\]]*)\]\(([^)]+)\)$", line)
        if m:
            html_parts.append(f'<img src="../{m.group(2)}" alt="{m.group(1)}">')
            continue

        # Unordered list item
        m = re.match(r"^\s*-\s+(.+)$", line)
        if m:
            if not in_list:
                html_parts.append("<ul>")
                in_list = True
            html_parts.append(f"  <li>{convert_inline(m.group(1))}</li>")
            continue

        # Empty line - skip
        if line.strip() == "":
            continue

        # Link on its own line
        m = re.match(r"^\[([^\]]+)\]\(([^)]+)\)$", line)
        if m:
            html_parts.append(f'<p><a href="{m.group(2)}">{m.group(1)}</a></p>')
            continue

        # Regular paragraph
        html_parts.append(f"<p>{convert_inline(line)}</p>")

    if in_list:
        html_parts.append("</ul>")

    return "\n".join(html_parts)


POST_TEMPLATE = """\
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title} - Brimbles</title>
  <link rel="stylesheet" href="../styles.css">
</head>
<body>
  <header>
    <h1><a href="../index.html">~/brimbles</a></h1>
    <p class="prompt">{title}</p>
  </header>

  <main>
    <article class="post">
      <p class="post-date">{date}</p>

{body}
    </article>
  </main>

  <footer>
    <p><a href="../index.html">&lt; back to projects</a></p>
  </footer>
</body>
</html>
"""

INDEX_TEMPLATE = """\
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Brimbles</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header>
    <h1>~/brimbles</h1>
    <p class="prompt">Bookmark this to keep an eye on my project updates</p>
  </header>

  <main>
    <h2>Projects</h2>

    <ul class="project-list">
{items}
    </ul>
  </main>

  <footer>
    <p class="prompt">end of transmission</p>
  </footer>
</body>
</html>
"""


def build():
    POSTS_DIR.mkdir(exist_ok=True)

    posts = []

    for md_file in sorted(DRAFTS_DIR.glob("*.md")):
        content = md_file.read_text(encoding="utf-8")
        meta, body = parse_frontmatter(content)

        title = meta.get("title", md_file.stem)
        date = meta.get("date", "unknown")
        summary = meta.get("summary", "")
        slug = md_file.stem

        body_html = convert_markdown(body)

        post_html = POST_TEMPLATE.format(title=title, date=date, body=body_html)
        out_path = POSTS_DIR / f"{slug}.html"
        out_path.write_text(post_html, encoding="utf-8")
        print(f"  Built: posts/{slug}.html")

        posts.append({"title": title, "date": date, "summary": summary, "slug": slug})

    # Sort by date, newest first
    posts.sort(key=lambda p: p["date"], reverse=True)

    # Build index
    items = ""
    for post in posts:
        items += f'      <li>\n'
        items += f'        <a href="posts/{post["slug"]}.html">{post["title"]}</a>\n'
        items += f'        <span class="post-date">{post["date"]}</span>\n'
        items += f'        <p>{post["summary"]}</p>\n'
        items += f'      </li>\n'

    index_html = INDEX_TEMPLATE.format(items=items)
    (ROOT_DIR / "index.html").write_text(index_html, encoding="utf-8")
    print(f"  Built: index.html")
    print(f"  Done! {len(posts)} post(s) built.")


if __name__ == "__main__":
    build()
