const mocha = require('mocha')
const path = require('path')
const QTestClient = require('./qTestClient')

let testSuiteId = process.env.QTEST_SUITE_ID
const buildUrl = process.env.QTEST_BUILD_URL

const parentType = process.env.QTEST_PARENT_TYPE
const parentId = process.env.QTEST_PARENT_ID
const testSuiteName = process.env.QTEST_SUITE_NAME

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

  const qTestClient = new QTestClient(qTestConfig.host, qTestConfig.bearerToken, qTestConfig.projectId)

  const log = qTestConfig.enableLogs ? (pad = 0, ...args) => console.log((pad ? '|' : '') + (' '.repeat(pad)), ...args) : () => { }
  log.TEST_PAD = 5
  log.HOOK_PAD = 4

  let mapping = null
  let promise
  if (testSuiteId) {
    console.log('qTestReporter: getting test runs of test suite', testSuiteId)
    promise = qTestClient.getSuiteTestRuns(testSuiteId).then(result => {
      mapping = result
      console.log('qTestReporter: test runs found', Object.keys(mapping).length, '\n')
    })
  } else {
    console.log('qTestReporter: creating test suite', testSuiteName)
    promise = qTestClient.createTestSuite(parentType, parentId, testSuiteName).then(result => {
      testSuiteId = result
      console.log('qTestReporter: test suite created', testSuiteId)
    })
  }

  mocha.reporters.Base.call(this, runner)

  let startDate = new Date()

  runner.on('start', () => {
    startDate = new Date()
    log(0, '\nTests execution started...\n')
  })

  runner.on('test', async (test) => {
    log(log.TEST_PAD, `> ${test.title}`)

    const testCaseId = getQTestId(test.title)
    if (!testCaseId) {
      return console.log('qTestReporter: test is not mapped to qTest')
    }

    test.qTestPromise = new Promise(async resolve => {
      await promise

      if (mapping && mapping[testCaseId]) {
        test.qTest = { testRun: mapping[testCaseId], testCase: { id: testCaseId } }
      } else {
        const testRun = await qTestClient.createTestRun(testSuiteId, testCaseId)
        if (!testRun) return resolve() // console.log("qTestReporter: testSuite doesn't include ")
        test.qTest = {
          testRun: testRun,
          testCase: { id: testCaseId }
        }
      }

      const idsLog = `testRunId: '${test.qTest.testRun.id}', testCaseId: '${testCaseId}'`
      test.qTest.executionLog = {
        name: test.qTest.testRun.name,
        build_url: buildUrl,
        automation_content: idsLog,
        note: `${test.title} \n${idsLog}`,
        exe_start_date: new Date().toISOString()
      }

      resolve()
    })
  })

  runner.on('pass', (test) => {
    log(log.TEST_PAD, `\x1b[1m\x1b[32m✓ PASSED`, '\x1b[0m', durationMsg(test.duration))
    log(1)

    if (!test.qTestPromise) return
    test.qTestPromise.then(() => {
      if (!test.qTest) return

      test.qTest.executionLog.status = qTestConfig.statePassed || 'PASS'
    })
  })

  runner.on('fail', (test, err) => {
    log(log.TEST_PAD, `\x1b[1m\x1b[31m\x1b[1mx FAILED`, '\x1b[0m', durationMsg(test.duration))
    log(log.TEST_PAD + 2, '\x1b[31m', err.stack, '\x1b[0m')
    log(1)

    if (!test.qTestPromise) return
    test.qTestPromise.then(() => {
      if (!test.qTest) return

      test.qTest.executionLog.status = qTestConfig.stateFailed || 'FAIL'
      test.qTest.executionLog.note += '\n\r\n' + err.stack
      // test.qTest.executionLog.attachments: [{
      //   name: 'screenshot.png',
      //   content_type: 'image/png',
      //   data: 'base64 string of Sample.docx'
      // }]
    })
  })

  runner.on('pending', (test) => {
    log(log.TEST_PAD, '\x1b[2m', `- PENDING: ${test.title}`, '\x1b[0m')
    log(1)
  })

  runner.on('test end', (test) => {
    if (!test.qTestPromise) return

    test.qTestPromise.then(async () => {
      if (!test.qTest) return

      test.qTest.executionLog.exe_end_date = new Date().toISOString()

      await qTestClient.postLog(test.qTest.testRun.id, test.qTest.executionLog)
    })
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

  runner.on('end', () => {
    log(0, '\nTests execution finished.', durationMsg(new Date() - startDate))
  })

  process.on('exit', () => {
    console.log('\nResults submitted to qTest:',
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

/**
 * Expose `Teamcity`.
 */
module.exports = qTest
