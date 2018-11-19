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

function qTest (runner, options = {}) {
  let getSuite, qTestClient
  let mapping = []
  const qTestConfig = getQTestConfig(options)

  if (!testSuiteId && (!parentId || !testSuiteName || !parentType)) {
    console.warn("qTestReporter: results won't be published.",
      'Please set either existing QTEST_SUITE_ID or combination of QTEST_PARENT_TYPE, QTEST_PARENT_ID and QTEST_SUITE_NAME to be created.')
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
  mocha.reporters.Base.call(this, runner)

  let startDate = new Date()

  let testResults = []

  runner.on('start', () => {
    startDate = new Date()
    log(0, '\nTests execution started...\n')
  })

  runner.on('test', async (test) => {
    log(log.TEST_PAD, `> ${test.title}`)

    // get qTestCaseId from test title
    const testCaseId = getQTestId(test.title)
    if (!testCaseId) {
      return console.log('qTestReporter: test is not mapped to qTest')
    }
    if (!qTestClient) return

    test.qTest = {
      executionLog: {
        build_url: buildUrl,
        exe_start_date: new Date().toISOString()
      },
      testCaseId,
      testTitle: test.title
    }
    testResults.push(test.qTest)
  })

  runner.on('pass', (test) => {
    log(log.TEST_PAD, `\x1b[1m\x1b[32m✓ PASSED`, '\x1b[0m', durationMsg(test.duration))
    log(1)

    if (!qTestClient || !test.qTest) return
    test.qTest.executionLog.status = qTestConfig.statePassed || 'PASS'
  })

  runner.on('fail', (test, err) => {
    log(log.TEST_PAD, `\x1b[1m\x1b[31m\x1b[1mx FAILED`, '\x1b[0m', durationMsg(test.duration))
    log(log.TEST_PAD + 2, '\x1b[31m', err.stack, '\x1b[0m')
    log(1)

    if (!qTestClient || !test.qTest) return

    test.qTest.executionLog.status = qTestConfig.stateFailed || 'FAIL'
    test.qTest.executionLog.note = err.stack
    // test.qTest.executionLog.attachments: [{
    //   name: 'screenshot.png',
    //   content_type: 'image/png',
    //   data: 'base64 string of Sample.docx'
    // }]
  })

  runner.on('pending', (test) => {
    log(log.TEST_PAD, '\x1b[2m', `- PENDING: ${test.title}`, '\x1b[0m')
    log(1)
  })

  runner.on('test end', (test) => {
    if (!qTestClient || !test.qTest) return
    test.qTest.executionLog.exe_end_date = new Date().toISOString()
  })

  runner.on('suite', function (suite) {
    if (suite.root) return

    if (suite.parent.root) {
      suite.startDate = new Date()
      log(0, suite.title)
    } else {
      log(1, suite.title)
    }
  })

  runner.on('suite end', function (suite) {
    if (suite.root || !suite.parent.root) return

    log(0, 'SUITE END', durationMsg(new Date() - suite.startDate), '\n')

    testResults = [...testResults, ...getNotStartedTests(suite.parent, qTestConfig)]
  })

  runner.on('hook', (hook) => {
    if (hook.title.includes('Global')) return
    log(log.HOOK_PAD, `~ ${hook.title}`)
  })

  runner.on('hook end', (hook) => {
    if (hook.title.includes('Global')) return
    log(log.HOOK_PAD, `~ DONE`, durationMsg(hook.duration))
  })

  runner.on('end', async () => {
    log(0, '\nTests execution finished.', durationMsg(new Date() - startDate))

    if (!qTestClient) return

    const failedState = qTestConfig.stateFailed || 'FAIL'

    // submit failed tests in the end to avoid marking failed tests as passed
    testResults.sort((a, b) => a.executionLog.status === failedState ? 1 : -1)

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
  })

  !process.listeners('exit').some(evt => {
    return evt.name === 'mochaQTestMappingReporter'
  }) && process.on('exit', function mochaQTestMappingReporter () {
    printReportUrl && console.log('\nResults submitted to qTest:',
      `\x1b[4m\nhttps://${qTestConfig.host}/p/${qTestConfig.projectId}/portal/project#tab=testexecution&object=2&id=${testSuiteId}\x1b[0m`)
  })
}

function getQTestId (title) {
  const match = title.match(/@qTest\[(.*?)\]/)
  return match ? match[1] : null
}

function durationMsg (duration = '?') {
  return `(${duration}ms)`
}

function setupLogger (qTestConfig) {
  const log = qTestConfig.enableLogs !== false ? (pad = 0, ...args) => {
    console.log((pad ? '|' : '') + (' '.repeat(pad)), ...args)
  } : () => { }
  log.TEST_PAD = 5
  log.HOOK_PAD = 4

  return log
}

function getQTestConfig (options) {
  const reporterOptions = options.reporterOptions || {}
  const pathToConfig = path.join(process.cwd(), reporterOptions.configFile)
  let qTestConfig

  if (reporterOptions.configFile) {
    if (fs.existsSync(pathToConfig)) {
      qTestConfig = require(pathToConfig)
    } else {
      console.error('qTestReporter: config file doesn\'t exist.')
    }
  } else {
    qTestConfig = reporterOptions.configOptions
  }

  return qTestConfig || {}
}

/**
 * get not started tests due to failure of before/beforeEach hook
 * @param {Mocha.Suite} suite
 * @param {Object} qTestConfig
 * @returns {Array}
 */
function getNotStartedTests (suite, qTestConfig) {
  const failedState = qTestConfig.stateFailed || 'FAIL'
  let tests = []

  if (suite.tests) {
    for (let i = 0; i < suite.tests.length; i++) {
      let test = suite.tests[i]
      if (test.qTest || test.state || test.pending) continue

      const testCaseId = getQTestId(test.title)
      if (!testCaseId) continue

      test.qTest = {
        executionLog: {
          build_url: buildUrl,
          exe_start_date: new Date().toISOString(),
          exe_end_date: new Date().toISOString(),
          status: failedState,
          note: 'Test was not started and marked as failed due to failure in before/beforeEach hook.'
        },
        testCaseId,
        testTitle: test.title
      }
      tests.push(test.qTest)
    }
  }

  if (suite.suites) {
    suite.suites.forEach(suite => {
      tests = [...tests, ...getNotStartedTests(suite, qTestConfig)]
    })
  }

  return tests
}

/**
 * Expose `Teamcity`.
 */
module.exports = qTest
