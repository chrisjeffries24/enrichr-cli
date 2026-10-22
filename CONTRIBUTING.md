# Contributing

Bug reports and pull requests are welcome.

## Run it

```bash
git clone https://github.com/chrisjeffries24/enrichr-cli
cd enrichr-cli
node bin/enrichr.mjs tokens example.com
npm test
```

Node 22 or newer. There is nothing to install: the package has no dependencies, and the tests use Node's built-in runner. The browser tests use whatever Chrome, Edge, Brave or Chromium is on your machine, and skip themselves if there is none.

## Where things are

| File | What it does |
|---|---|
| `src/cli.mjs` | commands, options, exit codes |
| `src/capture.mjs` | opens the page in your browser and reads it |
| `src/chrome.mjs`, `src/cdp.mjs` | finds the browser, starts it, speaks DevTools over a WebSocket |
| `src/probes/*.js` | the code that runs inside the page. Each file is one self-contained function |
| `src/static.mjs`, `src/css.mjs` | the no-browser mode and the CSS reader it uses |
| `src/tokens.mjs` | turns a capture into the stable token set every format reads |
| `src/format/*` | pretty, markdown, css, tailwind, dtcg |
| `src/deep.mjs` | the one command that talks to a server |

## Ground rules

- **Measure, don't guess.** A value in the output should come from the page. Where the CLI guesses (color roles, the spacing base unit), the report says so.
- **No dependencies.** If a change needs one, open an issue first.
- **Nothing leaves the machine** except in `deep.mjs`. A change that adds a network call anywhere else will be turned down.
- **Tests with the change.** Parsing and formatting changes get a unit test; anything the browser sees gets a check in `test/e2e.test.mjs` against the fixture site in `test/fixtures.mjs`.
- **Keep the probes honest.** The three probes `fonts.js`, `colors.js` and `motion.js` are copies of the ones in the Enrichr Chrome extensions. If you change one, change it in the [Enrichr repository](https://github.com/chrisjeffries24/enrichr) too, or the two will disagree.

## Reporting a bug

Include the command, the address (if public), what you expected, what you got, and the output of `enrichr doctor`. For a wrong font, color or size, the most useful thing is the element: right-click it, Inspect, and paste its computed `font-family`.
