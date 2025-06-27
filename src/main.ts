import * as artifact from '@actions/artifact'
import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as github from '@actions/github'
import * as os from 'os'
import * as path from 'path'
import {Formatter} from './formatter'
import {Octokit} from '@octokit/action'
import {glob} from 'glob'
import {promises} from 'fs'
import {randomUUID} from 'crypto'
const {stat} = promises

// from https://stackoverflow.com/a/51996206

function byteCount(string: string): number {
  // UTF8
  return encodeURI(string).split(/%..|./).length - 1
}

function truncateByBytes(string: string, byteSize: number): string {
  // UTF8
  if (byteCount(string) > byteSize) {
    const charsArray = string.split('')
    const truncatedStringArray = []
    let bytesCounter = 0
    for (const char of charsArray) {
      bytesCounter += byteCount(char)
      if (bytesCounter <= byteSize) {
        truncatedStringArray.push(char)
      } else {
        break
      }
    }
    return truncatedStringArray.join('')
  }
  return string
}

// End code from https://stackoverflow.com/a/51996206

async function run(): Promise<void> {
  core.debug(`running debug log`)
  core.info(`running info log`)
  // core.warning(`running warning log`)

  try {
    const inputPaths = core.getMultilineInput('path')
    const showPassedTests = core.getBooleanInput('show-passed-tests')
    const showCodeCoverage = core.getBooleanInput('show-code-coverage')
    const uploadBundles = core.getBooleanInput('upload-bundles')

    const bundlePaths: string[] = []
    for (const checkPath of inputPaths) {
      try {
        await stat(checkPath)
        bundlePaths.push(checkPath)
      } catch (error) {
        core.error((error as Error).message)
      }
    }
    let bundlePath = path.join(os.tmpdir(), `Merged_${randomUUID()}.xcresult`)
    if (bundlePaths.length > 1) {
      await mergeResultBundle(bundlePaths, bundlePath)
    } else if (bundlePaths.length === 0) {
      core.error('None of the input paths exists')
      throw Error(
        `None of the input paths exists: ${JSON.stringify(inputPaths)}`
      )
    } else {
      const inputPath = bundlePaths[0]
      await stat(inputPath)
      bundlePath = inputPath
    }

    const formatter = new Formatter(bundlePath)
    const report = await formatter.format({
      showPassedTests,
      showCodeCoverage
    })

    if (core.getInput('token')) {
      await core.summary.addRaw(report.reportSummary).write()

      const octokit = new Octokit()

      const owner = github.context.repo.owner
      const repo = github.context.repo.repo

      const pr = github.context.payload.pull_request
      const sha = (pr && pr.head.sha) || github.context.sha

      const charactersLimit = 65535
      let title = core.getInput('title')
      const truncatedTitle = truncateByBytes(title, charactersLimit - 1)
      if (truncatedTitle.length !== title.length) {
        core.warning(
          `The 'title' will be truncated because the character limit (${charactersLimit}) exceeded.`
        )
      }
      title = truncatedTitle
      let reportSummary = report.reportSummary
      const truncatedReportSummary = truncateByBytes(
        reportSummary,
        charactersLimit - 1
      )
      if (truncatedReportSummary.length !== reportSummary.length) {
        core.warning(
          `The 'summary' will be truncated because the character limit (${charactersLimit}) exceeded.`
        )
      }
      reportSummary = truncatedReportSummary
      let reportDetail = report.reportDetail
      const truncatedReportDetail = truncateByBytes(
        reportDetail,
        charactersLimit - 1
      )
      if (truncatedReportDetail.length !== reportDetail.length) {
        core.warning(
          `The 'text' will be truncated because the character limit (${charactersLimit}) exceeded.`
        )
      }
      reportDetail = truncatedReportDetail

      if (report.annotations.length > 50) {
        core.warning(
          'Annotations that exceed the limit (50) will be truncated.'
        )
      }
      const annotations = report.annotations.slice(0, 50)
      let output
      if (reportDetail.trim()) {
        output = {
          title: 'Xcode test results',
          summary: reportSummary,
          text: reportDetail,
          annotations
        }
      } else {
        output = {
          title: 'Xcode test results',
          summary: reportSummary,
          annotations
        }
      }
      await octokit.checks.create({
        owner,
        repo,
        name: title,
        head_sha: sha,
        status: 'completed',
        conclusion: report.testStatus,
        output
      })

      if (uploadBundles) {
        for (const uploadBundlePath of inputPaths) {
          try {
            await stat(uploadBundlePath)
          } catch (ignored) {
            continue
          }

          const artifactClient = new artifact.DefaultArtifactClient()
          const artifactName = path.basename(uploadBundlePath)

          const rootDirectory = uploadBundlePath

          try {
            const files = await glob(`${uploadBundlePath}/**/*`)
            if (files.length) {
              await artifactClient.uploadArtifact(
                artifactName,
                files,
                rootDirectory
              )
            }
          } catch (error) {
            core.error(error as Error)
          }
        }
      }
    }
  } catch (error) {
    core.setFailed((error as Error).message)
  }
}

run()

async function mergeResultBundle(
  inputPaths: string[],
  outputPath: string
): Promise<void> {
  const options = {
    silent: true
  }
  const use_symlinks = false
  if (use_symlinks) {
    core.info(`Executing: ${JSON.stringify(['mkdir', ['-p', './.t/']])}`)
    await exec.exec('mkdir', ['-p', './.t/'])
    const symlinkedInputs = []
    let counter = 0
    for (const inputPath of inputPaths) {
      const linkname = `./.t/in${counter}`
      symlinkedInputs.push(linkname)
      const lnArgs = ['-s', inputPath, linkname]
      core.info(`Executing: ${JSON.stringify(['ln', lnArgs])}`)
      await exec.exec('ln', lnArgs, options)
      counter = counter + 1
    }
    // const outlink = `./.t/out`
    // const lnArgs = ['-s', outputPath, outlink]
    // core.warning(`Executing: ${JSON.stringify(['ln', lnArgs])}`)
    // await exec.exec('ln', lnArgs, options)

    const args = ['xcresulttool', 'merge']
      .concat(symlinkedInputs)
      .concat(['--output-path', outputPath])
    core.info(`about to execute: "${JSON.stringify(['xcrun', args])}"`)
    await exec.exec('xcrun', args, options)
  } else {
    const args = ['xcresulttool', 'merge']
      .concat(inputPaths)
      .concat(['--output-path', outputPath])
    const optionsVerbose = {
      silent: false
    }
    core.info(`about to execute: "${JSON.stringify(['xcrun', args])}"`)
    await exec.exec('xcrun', args, optionsVerbose)
  }
}
