import { test } from "node:test";
import assert from "node:assert/strict";

import { classifyCameraError, mediaResultToFile } from "./nativeCamera.js";

test("classifyCameraError: cancelled via structured code (takePhoto)", () => {
  assert.equal(classifyCameraError({ code: "OS-PLUG-CAMR-0006", message: "..." }), "cancelled");
});

test("classifyCameraError: cancelled via structured code (chooseFromGallery)", () => {
  assert.equal(classifyCameraError({ code: "OS-PLUG-CAMR-0020", message: "..." }), "cancelled");
});

test("classifyCameraError: denied via structured code (camera)", () => {
  assert.equal(classifyCameraError({ code: "OS-PLUG-CAMR-0003", message: "..." }), "denied");
});

test("classifyCameraError: denied via structured code (gallery)", () => {
  assert.equal(classifyCameraError({ code: "OS-PLUG-CAMR-0005", message: "..." }), "denied");
});

test("classifyCameraError: falls back to message text when no/unknown code", () => {
  assert.equal(classifyCameraError({ message: "User cancelled photos app" }), "cancelled");
  assert.equal(classifyCameraError({ message: "User denied access to camera" }), "denied");
  assert.equal(classifyCameraError({ message: "User denied access to photos" }), "denied");
});

test("classifyCameraError: unrecognized error is a generic error", () => {
  assert.equal(classifyCameraError({ message: "Unable to convert image to jpeg" }), "error");
  assert.equal(classifyCameraError(new Error("boom")), "error");
  assert.equal(classifyCameraError(undefined), "error");
});

test("mediaResultToFile: builds a File from a fetchable webPath, honoring metadata.format", async () => {
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(url, "capacitor://localhost/photo.png");
    return { blob: async () => new Blob(["fake-bytes"], { type: "image/png" }) };
  };
  try {
    const file = await mediaResultToFile({
      webPath: "capacitor://localhost/photo.png",
      metadata: { format: "png" },
    });
    assert.equal(file.name, "photo.png");
    assert.equal(file.type, "image/png");
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test("mediaResultToFile: normalizes the 'jpg' format Android/iOS may report to 'jpeg'", async () => {
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ blob: async () => new Blob(["fake-bytes"], { type: "" }) });
  try {
    const file = await mediaResultToFile({
      webPath: "capacitor://localhost/photo.jpg",
      metadata: { format: "jpg" },
    });
    assert.equal(file.name, "photo.jpeg");
    assert.equal(file.type, "image/jpeg");
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test("mediaResultToFile: defaults to jpeg when no metadata is present", async () => {
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ blob: async () => new Blob(["fake-bytes"], { type: "" }) });
  try {
    const file = await mediaResultToFile({ uri: "file:///tmp/photo" });
    assert.equal(file.name, "photo.jpeg");
    assert.equal(file.type, "image/jpeg");
  } finally {
    globalThis.fetch = prevFetch;
  }
});
