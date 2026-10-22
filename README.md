# enrichr-cli

Read the design of any website from your terminal: the fonts it really draws, the colors that cover its pages, its type scale, spacing, radii and shadows, and its own CSS variables. It opens the page in the Chrome or Edge you already have, measures what rendered, and prints it or writes it as CSS, Tailwind or W3C design tokens.

```bash
npx enrichr-cli stripe.com
```

No dependencies, no browser download, no account. Nothing leaves your machine unless you run `enrichr deep`.

```
linear.app  Linear – The system for product development
Read in a real browser (desktop, light scheme) in 7.9s

Fonts
  Headings, body Inter Variable  web font, 84.1% of text  weights 300, 400, 500, 510, 590
  Code           Berkeley Mono  web font, 15.9% of text  weights 400

Type scale
  13px   400  lh 20px      ████·············· 23.3%  p span h3 a
  15px   400  lh 24px      ████·············· 24.7%  span p strong
  24px   400  lh 31.92px   █················· 6.1%  p
  48px   510  lh 48px      █················· 2.7%  h2 strong
  72px   510  lh 72px      █················· 0.4%  h2
```

*(Trimmed. Measured 22 October 2026; sites change.)*

## Install

Needs Node 22 or newer and one of Chrome, Edge, Brave or Chromium.

```bash
npx enrichr-cli tokens stripe.com      # run once, nothing installed
npm install -g enrichr-cli             # or install the `enrichr` command
enrichr doctor                         # checks Node and finds your browser
```

If no browser is found, `tokens`, `fonts` and `colors` fall back to reading the page's CSS (see [Static mode](#static-mode)). Set `CHROME_PATH` to point at a browser in an unusual place.

## Commands

| Command | What it prints |
|---|---|
| `enrichr tokens <url>` | colors, fonts, type scale, spacing, radii, shadows, breakpoints, transitions, and the site's CSS variables |
| `enrichr fonts <url>` | the fonts drawn on the page, which one sets headings, body and code, weights, share of text |
| `enrichr colors <url>` | the palette ranked by how much of the page each color covers, plus named color variables |
| `enrichr motion <url>` | animation and 3D libraries the page exposes: GSAP and its plugins, Three.js, Lenis, Lottie and about a dozen more |
| `enrichr inspect <url>` | all of the above in one pass |
| `enrichr deep <url>` | the same page analysed by Enrichr's servers; needs an API key ([below](#deep-analysis-through-enrichr)) |

`enrichr stripe.com` is short for `enrichr tokens stripe.com`. Addresses can be bare (`stripe.com`), `localhost:3000`, or full URLs.

## Output

`--format` (or `-f`) chooses what comes out. The default is a readable report in a terminal.

| Format | Use it for |
|---|---|
| `pretty` | reading |
| `json` (`-j`) | scripts. Stable shape; `schema` is bumped only when a field is removed or changes meaning |
| `css` | `:root { --color-accent: …; --font-heading: …; --text-base: …; }`. Add `--site-vars` to append the site's own variables |
| `tailwind` | a Tailwind CSS v4 `@theme` block |
| `dtcg` | [W3C Design Tokens](https://design-tokens.github.io/community-group/format/) JSON, for Style Dictionary and Tokens Studio |
| `markdown` | pasting into an issue, PR or design doc |

```bash
enrichr tokens linear.app -f css -o tokens.css
enrichr tokens linear.app -f tailwind >> app.css
enrichr tokens linear.app -f dtcg -o tokens.json
enrichr colors vercel.com --json | jq -r '.colors.palette[].hex'
```

Token names describe rank or size (`--color-palette-3`, `--text-xl`, `--radius-md`), never what the designer meant. The site's own names are in the JSON under `customProperties`, and `--site-vars` prints them.

Other options: `--viewport mobile|tablet|desktop`, `--dark` (read the page as a visitor with a dark color scheme; the default is always light, whatever your machine is set to), `--timeout <seconds>`, `--no-scroll`, `--chrome <path>`, `--no-color`, `-q`.

## How it measures

1. Starts your browser headless with a throwaway profile, at 1440×900.
2. Loads the page, waits for the network to go quiet, scrolls it once to wake lazy content, waits for fonts.
3. Reads the **computed** styles of up to 9,000 visible elements and weights each value by what it covers: text color by characters, backgrounds by area, borders by length, font sizes by characters of text.
4. Reads the text of every stylesheet through the DevTools protocol, which sees cross-origin sheets that scripts on the page cannot. That is how it finds a site's own custom property names.
5. Closes the browser and deletes the profile.

The page-side measurements are the same code the [Enrichr Chrome extensions](https://enrichr.dev/tools/chrome-extensions.html) run, so a result from the CLI and from an extension agree.

Things worth knowing:

- **Fonts are matched by what was drawn**, not what the CSS asks for. A web font that failed to load shows up as the fallback that replaced it. "Installed on this machine" means the font came from your operating system, so it can differ on someone else's computer.
- **Near-identical colors are merged** (within about 10 RGB units), so `#fafafa` and `#ffffff` count as one.
- **The roles are guesses.** Background, text, accent and border are chosen from coverage; the report says so. Accent prefers a vivid color over a pale tint that happens to cover more text.
- **Spacing base unit** is the first of 8, 4, 6, 5 and 10px, in that order, that explains at least 70% of the padding, margin and gap values. If none does, it says there is no single base.
- **It reads one page load.** Anything behind a click, or further down than the one scroll reaches, is not seen. It does not use your cookies or sessions, so a page behind a login shows its login screen.

## Static mode

`--static` (or no browser installed) skips the browser: it downloads the HTML and up to 15 stylesheets, parses them, and counts what the CSS declares. It is fast and runs anywhere, including CI. It cannot tell which colors cover the page or whether a font loaded, so colors and fonts are ranked by how often they are declared, and the output says it was read from CSS. `motion` and `inspect` need a browser.

```yaml
# a GitHub Actions step that fails the build if the brand color drifts
- run: npx enrichr-cli tokens http://localhost:3000 -f json --static | jq -e '.customProperties.all[] | select(.name=="--brand" and .hex=="#3b5bdb")'
```

## Deep analysis through Enrichr

A local read sees what the page exposes after it has loaded. It cannot see what ran before that: every GSAP tween and its easing, the shaders a WebGL scene compiled, the 3D scene. [Enrichr](https://enrichr.dev) hooks into the page before its own scripts run and captures those.

```bash
export ENRICHR_API_KEY=enrichr_...        # free key: https://enrichr.dev/account.html
enrichr deep stripe.com                   # design system, 1 credit
enrichr deep stripe.com --tool animations # every animation, 1 credit
enrichr deep stripe.com --tool brief      # a brief an AI tool can rebuild the page from, 10 credits
```

| `--tool` | Credits | Returns |
|---|---|---|
| `design` (default) | 1 | design system: colors, type scale, spacing and tokens |
| `animations` | 1 | GSAP, Framer Motion, CSS and scroll animations with durations and easings |
| `webgl` | 1 | WebGL contexts, shaders and draw calls |
| `dom` | 1 | the rendered DOM and computed styles |
| `assets` | 1 | images, fonts, video and other assets |
| `brief` | 10 | a written brief for rebuilding the page |

The free plan includes 30 credits a month and needs no card. `deep` is the only command that contacts a server, it sends the page address and the tool name, and it prints how many credits you have left. `ENRICHR_URL` points it at a self-hosted server.

## Privacy

- `tokens`, `fonts`, `colors`, `motion` and `inspect` send nothing to Enrichr or anyone else. They open the address you gave, in a browser on your machine, and print the result.
- There is no telemetry, no update check and no analytics.
- `--static` makes ordinary HTTP requests to the address you gave and the stylesheets it links to, with the user agent `enrichr-cli (+https://enrichr.dev)`.
- `deep` sends the URL and tool name to `ENRICHR_URL` (default `https://enrichr.dev`) with your key in the `X-API-Key` header.

The Enrichr repository has a test that fails if any file other than `static.mjs`, `deep.mjs` and the local DevTools socket client starts making network calls.

## Exit codes

`0` success, `1` the read failed (page would not load, no browser, bad key), `2` wrong usage.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). The tests need no setup:

```bash
npm test          # unit tests, plus a real-browser run against a fixture site if you have Chrome
```

## License

MIT. See [LICENSE](LICENSE).
