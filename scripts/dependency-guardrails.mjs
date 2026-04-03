import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultLockfilePath = path.join(repoRoot, "package-lock.json");
const defaultAllowlistPath = path.join(repoRoot, "scripts", "dependency-guardrails-allowlist.json");

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

export function packageNameFromLockfilePath(packagePath) {
  if (!packagePath) {
    return null;
  }

  const segments = packagePath.split("node_modules/").filter(Boolean);
  return segments.at(-1) ?? null;
}

export function collectInstallScriptPackages(lockfile) {
  return Object.entries(lockfile.packages ?? {})
    .filter(([packagePath, metadata]) => packagePath && metadata?.hasInstallScript)
    .map(([packagePath, metadata]) => ({
      name: metadata.name ?? packageNameFromLockfilePath(packagePath),
      version: metadata.version ?? null,
      packagePath,
      dev: Boolean(metadata.dev),
      optional: Boolean(metadata.optional),
    }))
    .sort((left, right) => {
      const leftKey = `${left.name ?? ""}@${left.version ?? ""}`;
      const rightKey = `${right.name ?? ""}@${right.version ?? ""}`;
      return leftKey.localeCompare(rightKey);
    });
}

export function validateInstallScriptAllowlist(installScriptPackages, allowlist) {
  const findings = [];
  const allowlistedPackages = allowlist?.packages ?? {};
  const seenNames = new Set();

  for (const pkg of installScriptPackages) {
    const allowlisted = allowlistedPackages[pkg.name];
    const packageLabel = `${pkg.name}@${pkg.version}`;
    seenNames.add(pkg.name);

    if (!pkg.name || !pkg.version) {
      findings.push(`${pkg.packagePath}: install-script package is missing a resolvable name or version in package-lock.json.`);
      continue;
    }

    if (!allowlisted) {
      findings.push(`${packageLabel} uses install scripts but is not in scripts/dependency-guardrails-allowlist.json.`);
      continue;
    }

    if (typeof allowlisted.reason !== "string" || !allowlisted.reason.trim()) {
      findings.push(`${packageLabel} is allowlisted without a review reason.`);
    }

    if (allowlisted.version !== pkg.version) {
      findings.push(
        `${pkg.name} allowlist version drifted: reviewed ${allowlisted.version}, lockfile resolved ${pkg.version}. Re-review before landing the change.`,
      );
    }
  }

  for (const [packageName, allowlisted] of Object.entries(allowlistedPackages)) {
    if (!seenNames.has(packageName)) {
      findings.push(
        `${packageName}@${allowlisted.version} remains in scripts/dependency-guardrails-allowlist.json but no longer appears in package-lock.json.`,
      );
    }
  }

  return findings;
}

export function evaluateDependencyGuardrails({
  lockfilePath = defaultLockfilePath,
  allowlistPath = defaultAllowlistPath,
} = {}) {
  const lockfile = readJson(lockfilePath);
  const allowlist = readJson(allowlistPath);
  const installScriptPackages = collectInstallScriptPackages(lockfile);
  const findings = validateInstallScriptAllowlist(installScriptPackages, allowlist);

  return {
    allowlist,
    findings,
    installScriptPackages,
  };
}

function formatPackageSummary(pkg, allowlist) {
  const reason = allowlist.packages?.[pkg.name]?.reason ?? "reason missing";
  return `- ${pkg.name}@${pkg.version}: ${reason}`;
}

function main() {
  const lockfilePath = process.argv[2] ? path.resolve(process.argv[2]) : defaultLockfilePath;
  const allowlistPath = process.argv[3] ? path.resolve(process.argv[3]) : defaultAllowlistPath;
  const result = evaluateDependencyGuardrails({ lockfilePath, allowlistPath });

  if (result.findings.length) {
    console.error("dependency guardrails failed:\n");
    result.findings.forEach((finding) => {
      console.error(`- ${finding}`);
    });
    process.exit(1);
  }

  console.log(`dependency guardrails passed for ${result.installScriptPackages.length} reviewed install-script package(s).`);
  result.installScriptPackages.forEach((pkg) => {
    console.log(formatPackageSummary(pkg, result.allowlist));
  });
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";

if (invokedPath === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
