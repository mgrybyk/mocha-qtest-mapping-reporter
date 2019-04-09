const mocha = require('mocha')
const path = require('path')
const fs = require('fs')
const QTestClient = require('./qTestClient')

let testSuiteId = process.env.QTEST_SUITE_ID
const buildUrl = process.env.QTEST_BUILD_URL

const parentType = process.env.QTEST_PARENT_TYPE
const parentId = process.env.QTEST_PARENT_ID
const testSuiteName = process.env.QTEST_SUITE_NAME

const createTestRuns = process.env.QTEST_CREATE_TEST_RUNS || true

let printReportUrl = false

/**
 * Initialize a new `qTest` reporter.
 *
 * @param {Runner} runner
 * @param {options} options
 * @api public
 */

function qTest(runner, options = {}) {
  let getSuite, qTestClient
  let mapping = []
  const qTestConfig = getQTestConfig(options)
  const stateFailed = qTestConfig.stateFailed || 'FAIL'
  const statePassed = qTestConfig.statePassed || 'PASS'
  const statePending = qTestConfig.statePending || 'PENDING'

  if (!testSuiteId && (!parentId || !testSuiteName || !parentType)) {
    if (!qTestConfig.hideWarning) {
      console.warn("qTestReporter: results won't be published.",
        'Please set either existing QTEST_SUITE_ID or combination of QTEST_PARENT_TYPE, QTEST_PARENT_ID and QTEST_SUITE_NAME to be created.')
    }
  } else if (!qTestConfig.host || !qTestConfig.bearerToken || !qTestConfig.projectId) {
    console.error("qTestReporter: results won't be published.",
      'host, bearerToken, projectId are required options.')
  } else {
    qTestClient = new QTestClient(qTestConfig.host, qTestConfig.bearerToken, qTestConfig.projectId)

    if (testSuiteId) {
      // use existing suite
      console.log('qTestReporter: getting test runs of test suite', testSuiteId)
      getSuite = qTestClient.getSuiteTestRuns(testSuiteId).then(result => {
        mapping = result
        printReportUrl = true
        console.log('qTestReporter: test runs found', Object.keys(result).length, '\n')
      })
    } else {
      // create new suite
      console.log('qTestReporter: creating test suite', testSuiteName)
      getSuite = qTestClient.createTestSuite(parentType, parentId, testSuiteName).then(result => {
        testSuiteId = result
        printReportUrl = true
        console.log('qTestReporter: test suite created', testSuiteId)
      })
    }
    getSuite.catch(err => {
      qTestClient = null
      console.log('qTestReporter: failed to get/create test suite:', testSuiteId || testSuiteName)
      console.error(err.message)
    })
  }

  const log = setupLogger(qTestConfig)

  let startDate = new Date()
  let testResults = []
  const events = {
    onRunnerStart() {
      startDate = new Date()
      log(0, '\nTests execution started...\n')
    },

    onTestStart(test) {
      log(log.TEST_PAD, `> ${test.title}`)

      // get qTestCaseId from test title
      const testCaseId = getQTestId(test.title)
      if (!testCaseId) {
        return console.log('qTestReporter: test is not mapped to qTest')
      }
      if (!qTestClient) { return }

      test.qTest = addTest(test.title, testCaseId, buildUrl)
      testResults.push(test.qTest)
    },

    onTestPass(test) {
      log(log.TEST_PAD, `\x1b[1m\x1b[32m✓ PASSED`, '\x1b[0m', durationMsg(test.duration))
      log(1)

      if (!qTestClient || !test.qTest) { return }
      test.qTest.executionLog.status = statePassed
    },

    onTestFail(test, err = {}) {
      log(log.TEST_PAD, `\x1b[1m\x1b[31m\x1b[1mx FAILED`, '\x1b[0m', durationMsg(test.duration))
      log(log.TEST_PAD + 2, '\x1b[31m', err.stack, '\x1b[0m')
      log(1)

      if (!qTestClient || !test.qTest) { return }

      test.qTest.executionLog.status = stateFailed
      test.qTest.executionLog.note = err.stack
      // test.qTest.executionLog.attachments: [{
      //   name: 'screenshot.png',
      //   content_type: 'image/png',
      //   data: 'base64 string of Sample.docx'
      // }]
    },

    onTestSkip(test) {
      log(log.TEST_PAD, '\x1b[2m', `- PENDING: ${test.title}`, '\x1b[0m')
      log(1)

      if (!qTestClient) { return }

      if (!test.qTest) {
        const testCaseId = getQTestId(test.title)
        if (!testCaseId) { return }
        test.qTest = addTest(test.title, testCaseId, buildUrl)
        testResults.push(test.qTest)
      }

      test.qTest.executionLog.status = statePending
    },

    onTestEnd(test) {
      if (!qTestClient || !test.qTest) { return }
      test.qTest.executionLog.exe_end_date = new Date().toISOString()
      if (!test.qTest.executionLog.status) {
        test.qTest.executionLog.status = statePending
      }
    },

    onSuiteStart(suite) {
      if (suite.root) { return }

      if (suite.parent && suite.parent.root) {
        suite.startDate = new Date()
        log(0, suite.title)
      } else {
        log(1, suite.title)
      }
    },

    onSuiteEnd(suite) {
      if (suite.root || !suite.parent || !suite.parent.root) { return }

      log(0, 'SUITE END', durationMsg(new Date() - suite.startDate), '\n')

      testResults = [...testResults, ...getNotStartedTests(suite.parent, stateFailed, statePending)]
    },

    onHookStart(hook) {
      if (hook.title.includes('Global')) { return }
      log(log.HOOK_PAD, `~ ${hook.title}`)
    },

    onHookEnd(hook) {
      if (hook.title.includes('Global')) { return }
      log(log.HOOK_PAD, `~ DONE`, durationMsg(hook.duration))
    },

    async onRunnerEnd() {
      log(0, '\nTests execution finished.', durationMsg(new Date() - startDate))

      if (!qTestClient) { return }

      // submit first passed, then pending and failed tests in the end
      // to avoid marking skipped or failed tests as passed
      testResults
        .sort((a, b) => a.executionLog.status === statePending ? -1 : 1)
        .sort((a, b) => a.executionLog.status === stateFailed ? 1 : -1)

      try {
        await getSuite
      } catch (err) {
        return console.error('qTestReporter: unable to publish results.')
      }

      console.log('qTestReporter: publishing results...')

      for (let i = 0; i < testResults.length; i++) {
        const { executionLog, testCaseId, testTitle } = testResults[i]

        let testRun
        if (mapping[testCaseId]) {
          // using existing test run
          testRun = mapping[testCaseId]
        } else if (createTestRuns) {
          // creating new test run
          testRun = await qTestClient.createTestRun(testSuiteId, testCaseId)
          mapping[testCaseId] = testRun
        }

        if (testRun) {
          const idsLog = `testRunId: '${testRun.id}', testCaseId: '${testCaseId}'`
          const logBody = Object.assign({},
            executionLog,
            {
              name: testRun.name,
              automation_content: idsLog,
              note: `${testTitle} \n${idsLog}` + (executionLog.note ? `\n\r\n ${executionLog.note}` : '')
            })

          await qTestClient.postLog(testRun.id, logBody)
        }
      }
    },

    mochaQTestMappingReporterExit() {
      !qTestConfig.hideResultUrl && printReportUrl && console.log('\nResults submitted to qTest:',
        `\x1b[4m\nhttps://${qTestConfig.host}/p/${qTestConfig.projectId}/portal/project#tab=testexecution&object=2&id=${testSuiteId}\x1b[0m`)
    }
  }

  // if runner is not passed just return events to allow user map them to desired events in their framework
  if (runner) {
    runner.on('start', events.onRunnerStart)
    runner.on('test', events.onTestStart)
    runner.on('pass', events.onTestPass)
    runner.on('fail', events.onTestFail)
    runner.on('pending', events.onTestSkip)
    runner.on('test end', events.onTestEnd)
    runner.on('suite', events.onSuiteStart)
    runner.on('suite end', events.onSuiteEnd)
    runner.on('hook', events.onHookStart)
    runner.on('hook end', events.onHookEnd)
    runner.on('end', events.onRunnerEnd)

    // hack for Cypress to avoid final message duplication
    if (!process.listeners('exit').some(evt => evt.name === 'mochaQTestMappingReporterExit')) {
      process.on('exit', events.mochaQTestMappingReporterExit)
    }

    mocha.reporters.Base.call(this, runner)
  }

  return events
}

function getQTestId(title) {
  const match = title.match(/@qTest\[(.*?)\]/)
  return match ? match[1] : null
}

function durationMsg(duration = '?') {
  return `(${duration}ms)`
}

function setupLogger(qTestConfig) {
  const log = qTestConfig.enableLogs !== false ? (pad = 0, ...args) => {
    console.log((pad ? '|' : '') + (' '.repeat(pad)), ...args)
  } : () => { }
  log.TEST_PAD = 5
  log.HOOK_PAD = 4

  return log
}

function getQTestConfig(options) {
  const configFile = (options.reporterOptions && options.reporterOptions.configFile) || options.configFile
  let qTestConfig

  if (configFile) {
    const pathToConfig = path.join(process.cwd(), configFile)
    if (fs.existsSync(pathToConfig)) {
      qTestConfig = require(pathToConfig)
    } else {
      console.error('qTestReporter: config file doesn\'t exist.')
    }
  } else {
    qTestConfig = (options.reporterOptions && options.reporterOptions.configOptions) || options
  }

  return qTestConfig || {}
}

/**
 * get not started tests due to failure of before/beforeEach hook
 * @param {Mocha.Suite} suite
 * @param {string} stateFailed
 * @param {string} statePending
 * @returns {Array}
 */
function getNotStartedTests(suite, stateFailed, statePending) {
  let tests = []

  if (suite.tests) {
    for (let i = 0; i < suite.tests.length; i++) {
      let test = suite.tests[i]
      if (test.qTest || test.state) continue

      const testCaseId = getQTestId(test.title)
      if (!testCaseId) continue

      test.qTest = {
        executionLog: {
          build_url: buildUrl,
          exe_start_date: new Date().toISOString(),
          exe_end_date: new Date().toISOString()
        },
        testCaseId,
        testTitle: test.title
      }
      if (test.pending) {
        test.qTest.executionLog.status = statePending
        test.qTest.executionLog.note = 'Test or its suite is skipped.'
      } else {
        test.qTest.executionLog.status = stateFailed
        test.qTest.executionLog.note = 'Test was not started and marked as failed due to failure in before/beforeEach hook.'
      }
      tests.push(test.qTest)
    }
  }

  if (suite.suites) {
    suite.suites.forEach(suite => {
      tests = [...tests, ...getNotStartedTests(suite, stateFailed, statePending)]
    })
  }

  return tests
}

function addTest(testTitle, testCaseId, buildUrl) {
  return {
    executionLog: {
      build_url: buildUrl,
      exe_start_date: new Date().toISOString()
    },
    testCaseId,
    testTitle
  }
}

/**
 * Expose `Mocha qTest Mapping Reporter`.
 */
module.exports = qTest
