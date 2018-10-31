const mocha = require('mocha')
const path = require('path')
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
  if (!testSuiteId && (!parentId || !testSuiteName || !parentType)) {
    return console.warn("qTestReporter: results won't be published.",
      'Please set either existing testSuiteId or existing testCycleId in combination with testSuiteName to be created.')
  }

  const qTestConfig = getQTestConfig(options)
  const qTestClient = new QTestClient(qTestConfig.host, qTestConfig.bearerToken, qTestConfig.projectId)

  const log = setupLogger(qTestConfig)

  let mapping = null
  let getSuite
  if (testSuiteId) {
    // use existing suite
    console.log('qTestReporter: getting test runs of test suite', testSuiteId)
    getSuite = qTestClient.getSuiteTestRuns(testSuiteId).then(result => {
      mapping = result
      printReportUrl = true
      console.log('qTestReporter: test runs found', Object.keys(mapping).length, '\n')
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

  mocha.reporters.Base.call(this, runner)

  let startDate = new Date()

  const testResults = []

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

    if (!test.qTest) return
    test.qTest.executionLog.status = qTestConfig.statePassed || 'PASS'
  })

  runner.on('fail', (test, err) => {
    log(log.TEST_PAD, `\x1b[1m\x1b[31m\x1b[1mx FAILED`, '\x1b[0m', durationMsg(test.duration))
    log(log.TEST_PAD + 2, '\x1b[31m', err.stack, '\x1b[0m')
    log(1)

    if (!test.qTest) return

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
    if (!test.qTest) return
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
    log(0, '\nTests execution finished. Publishing results to qTest.', durationMsg(new Date() - startDate))

    const failedState = qTestConfig.stateFailed || 'FAIL'

    // submit failed tests in the end to avoid marking failed tests as passed
    testResults.sort((a, b) => a.executionLog.status === failedState ? 1 : -1)

    await getSuite

    for (let i = 0; i < testResults.length; i++) {
      const { executionLog, testCaseId, testTitle } = testResults[i]

      console.log(testResults[i])

      let testRun
      if (mapping && mapping[testCaseId]) {
        // using existing test run
        testRun = mapping[testCaseId]
      } else if (createTestRuns) {
        // creating new test run
        testRun = await qTestClient.createTestRun(testSuiteId, testCaseId)
      }

      if (testRun) {
        const idsLog = `testRunId: '${testRun.id}', testCaseId: '${testCaseId}'`
        const logBody = {
          ...executionLog,
          name: testRun.name,
          automation_content: idsLog,
          note: `${testTitle} \n${idsLog} \n\r\n ${executionLog.note}`
        }

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

function durationMsg (duration) {
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
  let qTestConfig

  if (reporterOptions.configFile) {
    qTestConfig = require(path.join(process.cwd(), reporterOptions.configFile))
  } else {
    qTestConfig = reporterOptions.configOptions || {}
  }

  if (!qTestConfig.host || !qTestConfig.bearerToken || !qTestConfig.projectId) {
    throw new Error('qTestReporter: host, bearerToken, projectId are required options.')
  }

  return qTestConfig
}

/**
 * Expose `Teamcity`.
 */
module.exports = qTest
