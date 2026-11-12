// Turns Upptime's data into status.json for index.html: current status from history/,
// downtime from the incident issues (open..close, split per UTC day), monitoring start
// from the first commit of each history file.
import { readFileSync, writeFileSync } from 'node:fs';

const repo = process.env.GITHUB_REPOSITORY;
const DAY = 864e5, now = Date.now(), since = now - 90 * DAY;

const gh = async (path) => {
  const res = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
    headers: { authorization: `Bearer ${process.env.GH_TOKEN}`, accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res;
};

const firstCommitDate = async (file) => {
  const res = await gh(`commits?path=${file}&per_page=1`);
  const last = res.headers.get('link')?.match(/[?&]page=(\d+)>; rel="last"/)?.[1];
  const [c] = await (last ? (await gh(`commits?path=${file}&per_page=1&page=${last}`)).json() : res.json());
  return c.commit.committer.date;
};

const issues = [];
for (let page = 1; ; page++) {
  const batch = await (await gh(`issues?state=all&labels=status&per_page=100&page=${page}`)).json();
  issues.push(...batch.filter((i) => !i.pull_request));
  if (batch.length < 100) break;
}

const minutesPerDay = (incidents) => {
  const days = {};
  for (const i of incidents) {
    const end = i.closed_at ? Date.parse(i.closed_at) : now;
    for (let t = Date.parse(i.created_at); t < end; ) {
      const next = Math.min(end, (Math.floor(t / DAY) + 1) * DAY);
      const day = new Date(t).toISOString().slice(0, 10);
      days[day] = (days[day] || 0) + (next - t) / 6e4;
      t = next;
    }
  }
  for (const day in days) days[day] = Math.max(1, Math.round(days[day]));
  return days;
};

const sites = JSON.parse(readFileSync('history/summary.json', 'utf8'));
const components = await Promise.all(sites.map(async ({ name, slug }) => ({
  name,
  status: readFileSync(`history/${slug}.yml`, 'utf8').match(/^status: (\w+)/m)[1],
  start: await firstCommitDate(`history/${slug}.yml`),
  down: minutesPerDay(issues.filter((i) => i.labels.some((l) => l.name === slug))),
})));

const incidents = issues
  .filter((i) => !i.closed_at || Date.parse(i.closed_at) > since)
  .map((i) => ({
    name: sites.find((s) => i.labels.some((l) => l.name === s.slug))?.name,
    start: i.created_at,
    end: i.closed_at,
  }))
  .filter((i) => i.name);

writeFileSync(process.argv[2] || 'status.json', JSON.stringify({ components, incidents }));
