/*! Copyright [Amazon.com](http://amazon.com/), Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0 */
import * as path from "path";
import { Project } from "projen";
import { exec } from "projen/lib/util";
import { DocumentationFormat } from "../../../src";
import { OpenApiToolsJsonFile } from "../../../src/project/codegen/components/open-api-tools-json-file";
import {
  buildInvokeOpenApiGeneratorCommand,
  OtherGenerators,
} from "../../../src/project/codegen/components/utils";
import { withTmpDirSnapshot } from "../../project/snapshot-utils";

describe("Docs Generation Script Unit Tests", () => {
  it.each([
    DocumentationFormat.HTML2,
    DocumentationFormat.MARKDOWN,
    DocumentationFormat.PLANTUML,
  ])("Generates %s", (generator) => {
    const specPath = path.resolve(
      __dirname,
      `../../resources/specs/single.yaml`
    );

    expect(
      withTmpDirSnapshot(path.resolve(__dirname), (outdir) => {
        OpenApiToolsJsonFile.ensure(
          new Project({ name: "test-project", outdir })
        ).synthesize();
        const command = buildInvokeOpenApiGeneratorCommand({
          generator,
          specPath: path.relative(outdir, specPath),
          outputPath: outdir,
          generatorDirectory: OtherGenerators.DOCS,
        });
        exec(command.command, {
          cwd: command.workingDir,
        });
      })
    ).toMatchSnapshot();
  });
});