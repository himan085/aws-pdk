/*! Copyright [Amazon.com](http://amazon.com/), Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0 */
import * as path from "path";
import { Component, SampleFile } from "projen";
import { SmithyBuild } from "projen/lib/smithy/smithy-build";
import { SampleExecutable } from "./components/sample-executable";
import { SmithyBuildGradleFile } from "./components/smithy-build-gradle-file";
import { SmithyModelOptions } from "../../types";
import { TypeSafeApiModelProject } from "../type-safe-api-model-project";

/**
 * Options for a smithy build project
 */
export interface SmithyDefinitionOptions {
  /**
   * Smithy engine options
   */
  readonly smithyOptions: SmithyModelOptions;
}

/**
 * Creates a project which transforms a Smithy model to OpenAPI
 */
export class SmithyDefinition extends Component {
  /**
   * Path to the generated OpenAPI specification, relative to the project outdir
   */
  public readonly openApiSpecificationPath: string;
  /**
   * Name of the gradle project
   */
  public readonly gradleProjectName: string;

  /**
   * Reference to the build.gradle file component
   * @private
   */
  private readonly smithyBuildGradleFile: SmithyBuildGradleFile;
  /**
   * Reference to the smithy-build.json file component
   * @private
   */
  private readonly smithyBuild: SmithyBuild;

  constructor(
    project: TypeSafeApiModelProject,
    options: SmithyDefinitionOptions
  ) {
    super(project);

    const { smithyOptions } = options;

    const samplePath = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "samples",
      "smithy"
    );

    const gradleExecutables = ["gradlew", "gradlew.bat"];
    const gradleFiles = [
      "gradle/wrapper/gradle-wrapper.jar",
      "gradle/wrapper/gradle-wrapper.properties",
    ];

    // Add gradle wrapper files and executables
    gradleFiles.forEach((file) => {
      new SampleFile(project, file, {
        sourcePath: path.join(samplePath, file),
      });
    });
    gradleExecutables.forEach((executable) => {
      new SampleExecutable(project, executable, {
        sourcePath: path.join(samplePath, executable),
      });
    });

    // Ignore gradle wrapper by default
    if (smithyOptions.ignoreGradleWrapper ?? true) {
      project.gitignore.addPatterns("gradle");
      project.gitignore.addPatterns("gradlew");
      project.gitignore.addPatterns("gradlew.bat");
    }
    // Always ignore the .gradle dir which the wrapper downloads gradle into
    project.gitignore.addPatterns(".gradle");

    this.gradleProjectName = project.name.replace(/[\/\\:<>"?\*|]/g, "-");

    // Add settings.gradle
    new SampleFile(project, "settings.gradle", {
      contents: `rootProject.name = '${this.gradleProjectName}'`,
    });

    const modelDir = "src/main/smithy";

    // Always add the following required dependencies
    const requiredDependencies = [
      "software.amazon.smithy:smithy-cli",
      "software.amazon.smithy:smithy-model",
      "software.amazon.smithy:smithy-openapi",
      "software.amazon.smithy:smithy-aws-traits",
    ];
    const requiredSmithyDependencyVersion = "1.28.0";

    // Ensure dependencies always include the required dependencies, allowing users to customise the version
    const userSpecifiedDependencies =
      smithyOptions.smithyBuildOptions?.maven?.dependencies ?? [];
    const userSpecifiedDependencySet = new Set(
      userSpecifiedDependencies.map((dep) =>
        dep.split(":").slice(0, -1).join(":")
      )
    );

    const dependencies = [
      ...requiredDependencies
        .filter((requiredDep) => !userSpecifiedDependencySet.has(requiredDep))
        .map((dep) => `${dep}:${requiredSmithyDependencyVersion}`),
      ...userSpecifiedDependencies,
    ];

    // Add build.gradle
    this.smithyBuildGradleFile = new SmithyBuildGradleFile(project, {
      modelDir,
      dependencies,
      repositoryUrls: smithyOptions.smithyBuildOptions?.maven?.repositoryUrls,
    });

    const { namespace: serviceNamespace, serviceName } =
      smithyOptions.serviceName;

    // Create the default smithy model
    new SampleFile(project, path.join(modelDir, "main.smithy"), {
      contents: `$version: "2"
namespace ${serviceNamespace}

use aws.protocols#restJson1

/// A sample smithy api
@restJson1
service ${serviceName} {
    version: "1.0"
    operations: [SayHello]
}

@readonly
@http(method: "GET", uri: "/hello")
operation SayHello {
    input: SayHelloInput
    output: SayHelloOutput
    errors: [ApiError]
}

string Name
string Message

@input
structure SayHelloInput {
    @httpQuery("name")
    @required
    name: Name
}

@output
structure SayHelloOutput {
    @required
    message: Message
}

@error("client")
structure ApiError {
    @required
    errorMessage: Message
}
`,
    });

    // Create the smithy build json file
    this.smithyBuild = new SmithyBuild(project, {
      version: "2.0",
      ...smithyOptions.smithyBuildOptions,
      projections: {
        ...smithyOptions.smithyBuildOptions?.projections,
        openapi: {
          plugins: {
            openapi: {
              service: `${serviceNamespace}#${serviceName}`,
              // By default, preserve tags in the generated spec, but allow users to explicitly overwrite this
              tags: true,
              ...smithyOptions.smithyBuildOptions?.projections?.openapi?.plugins
                ?.openapi,
            },
          },
        },
      },
      maven: {
        // Filter out any file dependencies since these aren't supported in smithy-build.json
        dependencies: dependencies.filter(
          (dep) => !dep.startsWith(SmithyBuildGradleFile.fileDependencyPrefix)
        ),
        repositories: (
          smithyOptions.smithyBuildOptions?.maven?.repositoryUrls ?? [
            "https://repo.maven.apache.org/maven2/",
            "file://~/.m2/repository",
          ]
        ).map((url) => ({ url })),
      },
    });

    this.openApiSpecificationPath = path.join(
      "build",
      "smithyprojections",
      this.gradleProjectName,
      "openapi",
      "openapi",
      `${serviceName}.openapi.json`
    );

    // Copy the gradle files during build if they don't exist. We don't overwrite to allow users to BYO gradle wrapper
    // and set `ignoreGradleWrapper: false`.
    project.generateTask.exec("mkdir -p gradle/wrapper");
    const samplePathRelativeToProjectOutdir = path.relative(
      project.outdir,
      path.resolve(samplePath)
    );
    [...gradleFiles, ...gradleExecutables].forEach((file) => {
      project.generateTask.exec(
        `if [ ! -f ${file} ]; then cp ${path.join(
          samplePathRelativeToProjectOutdir,
          file
        )} ${file}; fi`
      );
    });

    // Build with gradle to generate smithy projections, and any other tasks
    project.generateTask.exec("./gradlew build");

    if (smithyOptions.ignoreSmithyBuildOutput ?? true) {
      // Ignore the build directory, and smithy-output which was the old build directory for the cli-based generation
      project.gitignore.addPatterns("build", "smithy-output");
    }
  }

  /**
   * Add maven-style or local file dependencies to the smithy model project
   * @param deps dependencies to add, eg "software.amazon.smithy:smithy-validation-model:1.27.2" or "file://../some/path/build/lib/my-shapes.jar
   */
  public addDeps(...deps: string[]) {
    this.smithyBuildGradleFile.addDeps(...deps);
    this.smithyBuild.addMavenDependencies(
      ...deps.filter(
        (dep) => !dep.startsWith(SmithyBuildGradleFile.fileDependencyPrefix)
      )
    );
  }

  /**
   * Add dependencies on other smithy models, such that their shapes can be imported in this project
   * @param deps smithy definitions to depend on
   */
  public addSmithyDeps(...deps: SmithyDefinition[]) {
    this.addDeps(
      ...deps.map(
        (dep) =>
          `${SmithyBuildGradleFile.fileDependencyPrefix}${path.join(
            path.relative(this.project.outdir, dep.project.outdir),
            "build",
            "libs",
            `${dep.gradleProjectName}.jar`
          )}`
      )
    );
  }
}