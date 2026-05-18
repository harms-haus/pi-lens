import { describe, it, expect } from "vitest";
import { languageFromPath } from "../language-config.js";

describe("languageFromPath", () => {
  it("should detect TypeScript from .ts extension", () => {
    const config = languageFromPath("/project/src/index.ts");
    expect(config).toBeDefined();
    expect(config!.language).toBe("typescript");
  });

  it("should detect TypeScript from .tsx extension", () => {
    const config = languageFromPath("/project/src/App.tsx");
    expect(config).toBeDefined();
    expect(config!.language).toBe("typescript");
  });

  it("should detect TypeScript from .js extension", () => {
    const config = languageFromPath("/project/src/index.js");
    expect(config).toBeDefined();
    expect(config!.language).toBe("typescript");
  });

  it("should detect TypeScript from .jsx extension", () => {
    const config = languageFromPath("/project/src/App.jsx");
    expect(config).toBeDefined();
    expect(config!.language).toBe("typescript");
  });

  it("should detect Python from .py extension", () => {
    const config = languageFromPath("/project/main.py");
    expect(config).toBeDefined();
    expect(config!.language).toBe("python");
  });

  it("should detect Rust from .rs extension", () => {
    const config = languageFromPath("/project/src/main.rs");
    expect(config).toBeDefined();
    expect(config!.language).toBe("rust");
  });

  it("should detect Go from .go extension", () => {
    const config = languageFromPath("/project/main.go");
    expect(config).toBeDefined();
    expect(config!.language).toBe("go");
  });

  it("should detect C/C++ from .c extension", () => {
    const config = languageFromPath("/project/main.c");
    expect(config).toBeDefined();
    expect(config!.language).toBe("cpp");
  });

  it("should detect C/C++ from .cpp extension", () => {
    const config = languageFromPath("/project/main.cpp");
    expect(config).toBeDefined();
    expect(config!.language).toBe("cpp");
  });

  it("should detect C/C++ from .h extension", () => {
    const config = languageFromPath("/project/header.h");
    expect(config).toBeDefined();
    expect(config!.language).toBe("cpp");
  });

  it("should detect Java from .java extension", () => {
    const config = languageFromPath("/project/Main.java");
    expect(config).toBeDefined();
    expect(config!.language).toBe("java");
  });

  it("should detect Ruby from .rb extension", () => {
    const config = languageFromPath("/project/script.rb");
    expect(config).toBeDefined();
    expect(config!.language).toBe("ruby");
  });

  it("should detect Lua from .lua extension", () => {
    const config = languageFromPath("/project/script.lua");
    expect(config).toBeDefined();
    expect(config!.language).toBe("lua");
  });

  it("should detect HTML from .html extension", () => {
    const config = languageFromPath("/project/index.html");
    expect(config).toBeDefined();
    expect(config!.language).toBe("html");
  });

  it("should detect CSS from .css extension", () => {
    const config = languageFromPath("/project/styles.css");
    expect(config).toBeDefined();
    expect(config!.language).toBe("css");
  });

  it("should detect JSON from .json extension", () => {
    const config = languageFromPath("/project/config.json");
    expect(config).toBeDefined();
    expect(config!.language).toBe("json");
  });

  it("should detect YAML from .yaml extension", () => {
    const config = languageFromPath("/project/config.yaml");
    expect(config).toBeDefined();
    expect(config!.language).toBe("yaml");
  });

  it("should detect YAML from .yml extension", () => {
    const config = languageFromPath("/project/config.yml");
    expect(config).toBeDefined();
    expect(config!.language).toBe("yaml");
  });

  it("should detect Markdown from .md extension", () => {
    const config = languageFromPath("/project/README.md");
    expect(config).toBeDefined();
    expect(config!.language).toBe("markdown");
  });

  it("should detect Dockerfile from bare filename", () => {
    const config = languageFromPath("/project/Dockerfile");
    expect(config).toBeDefined();
    expect(config!.language).toBe("dockerfile");
  });

  it("should detect Dockerfile from .dockerfile extension", () => {
    const config = languageFromPath("/project/Container.dockerfile");
    expect(config).toBeDefined();
    expect(config!.language).toBe("dockerfile");
  });

  it("should detect Bash from .sh extension", () => {
    const config = languageFromPath("/project/script.sh");
    expect(config).toBeDefined();
    expect(config!.language).toBe("bash");
  });

  it("should detect R from .r extension", () => {
    const config = languageFromPath("/project/analysis.r");
    expect(config).toBeDefined();
    expect(config!.language).toBe("r");
  });

  it("should detect R from .R extension", () => {
    const config = languageFromPath("/project/analysis.R");
    expect(config).toBeDefined();
    expect(config!.language).toBe("r");
  });

  it("should return undefined for unknown extensions", () => {
    expect(languageFromPath("/project/data.csv")).toBeUndefined();
    expect(languageFromPath("/project/image.png")).toBeUndefined();
    expect(languageFromPath("/project/data.txt")).toBeUndefined();
  });

  it("should return undefined for files without extension that don't match a config", () => {
    expect(languageFromPath("/project/Makefile")).toBeUndefined();
    expect(languageFromPath("/project/.gitignore")).toBeUndefined();
  });

  it("should handle paths with multiple dots", () => {
    const config = languageFromPath("/project/file.test.ts");
    expect(config).toBeDefined();
    expect(config!.language).toBe("typescript");
  });

  it("should handle Windows-style paths", () => {
    const config = languageFromPath("C:\\project\\index.ts");
    expect(config).toBeDefined();
    expect(config!.language).toBe("typescript");
  });
});
