import type { NextConfig } from "next";

// This repo is nested inside an unrelated legacy project (a separate git
// repo/app one level up, with its own package-lock.json and node_modules).
// Next.js's automatic workspace-root detection walks up looking for a
// lockfile and lands on that outer, unrelated one, which misdirects module
// resolution (observed as spurious @types/node resolution errors). Pin the
// root explicitly to this project directory to avoid that.
const projectRoot = __dirname;

// Native (Capacitor) builds produce a static export into `out/` so
// Capacitor can bundle it. The normal web build is untouched: it still runs
// as a standard Next.js server build. Toggled via BUILD_TARGET=native
// (see the `build:native` script in package.json) rather than a global
// switch, so the two build paths stay independent.
const isNativeBuild = process.env.BUILD_TARGET === "native";

const nextConfig: NextConfig = {
  /* config options here */
  reactStrictMode: true,
  turbopack: {
    root: projectRoot,
  },
  ...(isNativeBuild ? { output: "export" as const } : {}),
};

export default nextConfig;
