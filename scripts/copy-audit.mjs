import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const findings = [];

const scanRoots = [
  "components/pages",
  "components/layout",
  "app",
  "lib/quest-agent",
];

const allowedLocaleJaFiles = new Set([
  path.join(root, "lib/quest-agent/copy.ts"),
  path.join(root, "lib/quest-agent/derive.ts"),
  path.join(root, "lib/quest-agent/detect-return.ts"),
  path.join(root, "lib/quest-agent/server/ai.ts"),
]);

const allowedEnglishUiFiles = new Set([
  path.join(root, "lib/quest-agent/copy.ts"),
  path.join(root, "lib/quest-agent/derive.ts"),
  path.join(root, "lib/quest-agent/detect-return.ts"),
  path.join(root, "lib/quest-agent/server/ai.ts"),
]);

const suspiciousEnglishTerms = [
  "Focus Goal",
  "Resume Queue",
  "WIP limit",
  "Mirror",
  "Return",
  "Open Return",
  "Today",
  "Portfolio",
  "Review",
  "Intake",
  "Map",
];

const mojibakePatterns = [
  { label: "replacement character", regex: /�/u },
  { label: "question-mark run", regex: /\?{4,}/ },
  { label: "UTF-8 garble fragment", regex: /Ã.|Â.|â€|ãƒ|ã‚|ï¼|ï½/u },
];

function walk(dir) {
  const absDir = path.join(root, dir);
  const entries = readdirSync(absDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absPath = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(path.relative(root, absPath)));
      continue;
    }

    if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(absPath);
    }
  }

  return files;
}

function lineInfo(text, index) {
  const before = text.slice(0, index);
  const line = before.split(/\r?\n/).length;
  const lastNewline = before.lastIndexOf("\n");
  const column = index - lastNewline;
  return { line, column };
}

function addFinding(file, index, rule, detail) {
  const text = readFileSync(file, "utf8");
  const { line, column } = lineInfo(text, index);
  findings.push({ file: path.relative(root, file), line, column, rule, detail });
}

function scanFile(file) {
  const text = readFileSync(file, "utf8");

  for (const pattern of mojibakePatterns) {
    const match = pattern.regex.exec(text);
    if (match) {
      addFinding(file, match.index, "mojibake", pattern.label);
    }
  }

  if (
    file.includes(`${path.sep}components${path.sep}pages${path.sep}`) &&
    !allowedLocaleJaFiles.has(file)
  ) {
    for (const match of text.matchAll(/locale\s*===\s*["']ja["']/g)) {
      const snippet = text.slice(match.index, match.index + 160);
      if (/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(snippet)) {
        addFinding(file, match.index, "inline-locale-ja", "Move UI copy into lib/quest-agent/copy.ts.");
        break;
      }
    }
  }

  if (!allowedEnglishUiFiles.has(file)) {
    const lines = text.split(/\r?\n/);
    lines.forEach((lineText, index) => {
      if (/^\s*import\s/.test(lineText) || /from\s+["']/.test(lineText) || /https?:\/\//.test(lineText)) {
        return;
      }

      for (const term of suspiciousEnglishTerms) {
        const quoted = new RegExp(`["'\\\`]${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'\\\`]`);
        if (quoted.test(lineText)) {
          findings.push({
            file: path.relative(root, file),
            line: index + 1,
            column: lineText.indexOf(term) + 1,
            rule: "direct-english-ui",
            detail: `Move \"${term}\" into the copy dictionary or a label map.`,
          });
          return;
        }
      }
    });
  }
}

const files = scanRoots.flatMap((dir) => walk(dir));
files.forEach(scanFile);

if (findings.length) {
  console.error("copy audit found issues:\n");
  findings.forEach((finding) => {
    console.error(`- ${finding.file}:${finding.line}:${finding.column} [${finding.rule}] ${finding.detail}`);
  });
  process.exit(1);
}

console.log("copy audit passed");



