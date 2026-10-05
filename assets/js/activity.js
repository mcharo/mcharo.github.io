// Renders the activity page from the public GitHub REST API. Responses are
// cached in localStorage so repeat visits stay well under the unauthenticated
// rate limit of 60 requests per hour per IP address.

const API = "https://api.github.com";
const CACHE_TTL = 10 * 60 * 1000;
const RECENT_COUNT = 8;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

const root = document.getElementById("activity");
const user = root.dataset.user;
const cacheKey = `activity:v1:${user}`;
// Pushes to this site's own repo aren't interesting activity to show on it.
const siteRepo = `${user}.github.io`.toLowerCase();

const $ = (id) => document.getElementById(id);

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null && c !== ""));
  return node;
}

// --- Data ------------------------------------------------------------------

class GitHubError extends Error {
  constructor(status, resetAt) {
    super(`GitHub API responded with ${status}`);
    this.status = status;
    this.resetAt = resetAt;
  }
}

async function getJSON(path) {
  const res = await fetch(API + path, { headers: { Accept: "application/vnd.github+json" } });
  if (!res.ok) {
    const limited = res.headers.get("x-ratelimit-remaining") === "0";
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    throw new GitHubError(res.status, limited && reset ? new Date(reset * 1000) : null);
  }
  return res.json();
}

async function fetchRepos() {
  const repos = [];
  for (let page = 1; page <= 5; page++) {
    const batch = await getJSON(`/users/${user}/repos?type=owner&sort=pushed&per_page=100&page=${page}`);
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return repos;
}

async function fetchActivity() {
  const [profile, repos] = await Promise.all([getJSON(`/users/${user}`), fetchRepos()]);
  return {
    fetchedAt: Date.now(),
    joinedAt: profile.created_at,
    publicRepos: profile.public_repos,
    repos: repos.map((r) => ({
      name: r.name,
      url: r.html_url,
      description: r.description,
      language: r.language,
      fork: r.fork,
      createdAt: r.created_at,
      pushedAt: r.pushed_at,
    })),
  };
}

function readCache() {
  try {
    return JSON.parse(localStorage.getItem(cacheKey));
  } catch {
    return null;
  }
}

function writeCache(data) {
  try {
    localStorage.setItem(cacheKey, JSON.stringify(data));
  } catch {
    // Storage can be full or blocked; the page works without it.
  }
}

// --- Formatting ------------------------------------------------------------

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const fullDate = new Intl.DateTimeFormat("en", { dateStyle: "long", timeStyle: "short" });
const clock = new Intl.DateTimeFormat("en", { timeStyle: "short" });
const monthYear = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" });
const UNITS = [
  ["year", 365 * 864e5],
  ["month", 30 * 864e5],
  ["week", 7 * 864e5],
  ["day", 864e5],
  ["hour", 36e5],
  ["minute", 6e4],
];

function timeAgo(iso) {
  const diff = new Date(iso) - Date.now();
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return relative.format(Math.round(diff / ms), unit);
  }
  return "just now";
}

function timeEl(iso, className) {
  return el("time", { className, dateTime: iso, title: fullDate.format(new Date(iso)), textContent: timeAgo(iso) });
}

// --- Rendering -------------------------------------------------------------

function renderNow(repo) {
  const link = $("now-repo");
  link.textContent = repo.name;
  link.href = repo.url;
  const when = $("now-when");
  when.dateTime = repo.pushedAt;
  when.title = fullDate.format(new Date(repo.pushedAt));
  when.textContent = timeAgo(repo.pushedAt);
  $("now-desc").textContent = repo.description ?? "";
  $("now-desc").hidden = !repo.description;
  $("now").hidden = false;
}

function renderRecent(repos) {
  $("recent-list").replaceChildren(...repos.map((repo) => el("li", { className: "repo" },
    el("span", {},
      el("a", { className: "repo-name", href: repo.url, textContent: repo.name }),
      repo.fork ? el("span", { className: "repo-fork", textContent: "fork" }) : null),
    timeEl(repo.pushedAt, "repo-when"),
    el("p", { className: "repo-desc", textContent: repo.description ?? "" }),
    el("span", { className: "repo-lang", textContent: repo.language ?? "" }),
  )));
  $("recent").hidden = repos.length === 0;
}

function renderStarted(repos, joinedAt) {
  const byMonth = new Map();
  for (const repo of repos) {
    if (repo.fork) continue;
    const key = repo.createdAt.slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(repo);
  }

  const first = joinedAt.slice(0, 7);
  const last = new Date().toISOString().slice(0, 7);
  const cells = [el("span")];
  for (const name of MONTHS) {
    cells.push(el("span", { className: "month", textContent: name[0], ariaHidden: "true" }));
  }

  const listItems = [];
  for (let year = Number(last.slice(0, 4)); year >= Number(first.slice(0, 4)); year--) {
    cells.push(el("span", { className: "year", textContent: year }));
    const yearRepos = [];
    MONTHS.forEach((_, i) => {
      const key = `${year}-${String(i + 1).padStart(2, "0")}`;
      const started = byMonth.get(key) ?? [];
      yearRepos.push(...started.map((r) => `${r.name} (${MONTHS[i].slice(0, 3)})`));
      if (key < first || key > last) {
        cells.push(el("span", { className: "cell is-out" }));
      } else if (started.length === 0) {
        cells.push(el("span", { className: "cell" }));
      } else {
        const names = started.map((r) => r.name);
        const label = monthYear.format(new Date(`${key}-01T00:00:00Z`));
        const cell = el("button", {
          type: "button",
          className: "cell",
          ariaLabel: `${label}: ${names.join(", ")}`,
        });
        cell.dataset.level = Math.min(started.length, 3);
        cell.dataset.label = label;
        cell.dataset.names = JSON.stringify(names);
        cells.push(cell);
      }
    });
    if (yearRepos.length) {
      listItems.push(el("li", {}, el("strong", { textContent: year }), `: ${yearRepos.join(", ")}`));
    }
  }

  $("calendar").replaceChildren(...cells);
  $("started-list").replaceChildren(...listItems);
  $("started").hidden = false;
}

function showTip(cell) {
  const tip = $("tip");
  tip.replaceChildren(
    el("strong", { textContent: cell.dataset.label }),
    ...JSON.parse(cell.dataset.names).flatMap((name, i) => (i ? [el("br"), name] : [name])),
  );
  const wrap = cell.closest(".calendar-wrap").getBoundingClientRect();
  const box = cell.getBoundingClientRect();
  tip.style.left = `${box.left - wrap.left + box.width / 2}px`;
  tip.style.top = `${box.top - wrap.top}px`;
  tip.hidden = false;
  // Keep the tooltip inside the viewport on narrow screens.
  const overflow = tip.getBoundingClientRect();
  if (overflow.left < 8) tip.style.left = `${parseFloat(tip.style.left) + 8 - overflow.left}px`;
  if (overflow.right > innerWidth - 8) tip.style.left = `${parseFloat(tip.style.left) - (overflow.right - innerWidth + 8)}px`;
}

function hideTip() {
  $("tip").hidden = true;
}

function setupTips() {
  const calendar = $("calendar");
  const target = (event) => event.target.closest?.("button.cell");
  calendar.addEventListener("pointerover", (e) => target(e) && showTip(target(e)));
  calendar.addEventListener("pointerout", (e) => target(e) && hideTip());
  calendar.addEventListener("focusin", (e) => target(e) && showTip(target(e)));
  calendar.addEventListener("focusout", hideTip);
  document.addEventListener("keydown", (e) => e.key === "Escape" && hideTip());
}

function render(data) {
  const repos = data.repos
    .filter((r) => r.name.toLowerCase() !== siteRepo)
    .sort((a, b) => b.pushedAt.localeCompare(a.pushedAt));

  if (repos.length === 0) {
    setStatus(`${user} has no public repositories yet.`);
    return;
  }
  renderNow(repos[0]);
  renderRecent(repos.slice(1, 1 + RECENT_COUNT));
  renderStarted(repos, data.joinedAt);

  const since = monthYear.format(new Date(data.joinedAt));
  $("summary").textContent = `${data.publicRepos} public repos since ${since}.`;
}

function setStatus(...content) {
  const status = $("status");
  status.replaceChildren(...content);
  status.hidden = content.length === 0;
}

function explain(error) {
  if (error instanceof GitHubError && error.resetAt) {
    return `GitHub’s API limit for your network is used up until ${clock.format(error.resetAt)}.`;
  }
  if (error instanceof GitHubError) return `GitHub’s API returned an error (${error.status}).`;
  return "GitHub couldn’t be reached.";
}

async function main() {
  setupTips();
  const cached = readCache();
  if (cached?.repos) {
    render(cached);
    setStatus();
    if (Date.now() - cached.fetchedAt < CACHE_TTL) return;
  } else {
    setStatus("Loading activity from GitHub…");
  }

  try {
    const data = await fetchActivity();
    writeCache(data);
    render(data);
    setStatus();
  } catch (error) {
    const profile = el("a", { href: `https://github.com/${user}`, textContent: `github.com/${user}` });
    if (cached?.repos) {
      setStatus(`Showing activity as of ${timeAgo(new Date(cached.fetchedAt).toISOString())}. ${explain(error)}`);
    } else {
      setStatus(`${explain(error)} Try again later, or see `, profile, ".");
    }
  }
}

main();
