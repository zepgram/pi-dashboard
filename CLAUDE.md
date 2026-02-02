# CLAUDE.md

Guidelines for AI agents working on this project.

## Documentation

**Always refer to `README.md`** for project overview, features, API endpoints, and configuration.

**Keep README.md updated** when:
- Adding new features or sections
- Adding/modifying API endpoints
- Changing configuration options
- Updating Docker setup

## Project Structure

```
server/index.js    # Express API + all backend logic
src/main.js        # Frontend JavaScript
src/style.css      # All styles
src/index.html     # HTML structure
```

## Display Modes

The dashboard has 3 display modes, toggled via the compact button in the header:

| Mode | Body Class | Description |
|------|------------|-------------|
| Normal | _(none)_ | Full layout with all details |
| Compact | `body.compact` | Reduced padding, smaller fonts, condensed cards |
| Ultra | `body.ultra` | Minimal layout for small screens or kiosk mode |

### CSS Pattern

When adding new components, include styles for all display modes:

```css
/* Normal mode */
.my-component {
  padding: 16px;
  font-size: 14px;
}

/* Compact mode */
body.compact .my-component {
  padding: 8px;
  font-size: 12px;
}

/* Ultra compact mode */
body.ultra .my-component {
  padding: 4px;
  font-size: 11px;
}
```

### JavaScript

Display mode is stored in `displayMode` variable (`'normal'` | `'compact'` | `'ultra'`).

Toggle cycles: normal → compact → ultra → normal

## Build & Deploy

```bash
# Development
npm run dev

# Docker rebuild
docker compose up -d --build
```

## Conventions

- Commit messages: `feat:`, `fix:`, `chore:`, `docs:`
- CSS: Use CSS variables from `:root` (colors, spacing, radius)
- API: Internal endpoints under `/api/`, external under `/api/v1/`
