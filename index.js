const mocha = require('mocha')
const path = require('path')
const QTestClient = require('./qTestClient')

const testSuiteId = process.env.QTEST_SUITE_ID
const buildUrl = process.env.QTEST_BUILD_URL

/**
 * Initialize a new `qTest` reporter.
 *
 * @param {Runner} runner
 * @param {options} options
 * @api public
 */

function qTest (runner, options = {}) {
  if (!testSuiteId) {
    return console.warn('qTestReporter: disabled because QTEST_SUITE_ID is not set.')
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

  console.log('qTestReporter: getting test runs of test suite', testSuiteId)
  const mapping = qTestClient.getSuiteTestRuns(testSuiteId)
  console.log('qTestReporter: test runs found', Object.keys(mapping).length, '\n')

  mocha.reporters.Base.call(this, runner)

  let startDate = new Date()

  runner.on('start', () => {
    startDate = new Date()
    log(0, '\nTests execution started...\n')
  })

  runner.on('test', (test) => {
    log(log.TEST_PAD, `> ${test.title}`)

    const testCaseId = getQTestId(test.title)
    if (!testCaseId || !mapping[testCaseId]) return

    const idsLog = `testRunId: '${mapping[testCaseId].id}', testCaseId: '${testCaseId}'`
    test.executionLog = {
      name: mapping[testCaseId].name,
      build_url: buildUrl,
      automation_content: idsLog,
      note: `${test.title} \n${idsLog}`,
      exe_start_date: new Date().toISOString(),
      test_step_logs: [{
        description: test.title,
        expected_result: ''
      }]
    }
  })

  runner.on('pass', (test) => {
    log(log.TEST_PAD, `\x1b[1m\x1b[32m✓ PASSED`, '\x1b[0m', durationMsg(test.duration))
    log(1)

    const testCaseId = getQTestId(test.title)
    if (!testCaseId || !mapping[testCaseId]) return

    test.executionLog.status = qTestConfig.statePassed || 'PASS'
    test.executionLog.test_step_logs[0].status = test.executionLog.status
  })

  runner.on('fail', (test, err) => {
    log(log.TEST_PAD, `\x1b[1m\x1b[31m\x1b[1mx FAILED`, '\x1b[0m', durationMsg(test.duration))
    log(log.TEST_PAD + 2, '\x1b[31m', err.stack, '\x1b[0m')
    log(1)

    const testCaseId = getQTestId(test.title)
    if (!testCaseId || !mapping[testCaseId]) return

    test.executionLog.status = qTestConfig.stateFailed || 'FAIL'
    test.executionLog.test_step_logs[0] = {
      ...test.executionLog.test_step_logs[0],
      actual_result: err.stack,
      status: test.executionLog.status
      // TODO
      // attachments: [{
      //   name: 'screenshot.png',
      //   content_type: 'image/png',
      //   data: 'base64 string of Sample.docx'
      // }]
    }
  })

  runner.on('pending', (test) => {
    log(log.TEST_PAD, '\x1b[2m', `- PENDING: ${test.title}`, '\x1b[0m')
    log(1)
  })

  runner.on('test end', (test) => {
    const testCaseId = getQTestId(test.title)
    if (!testCaseId || !mapping[testCaseId] || !test.executionLog) return

    test.executionLog.exe_end_date = new Date().toISOString()

    qTestClient.postLog(mapping[testCaseId].id, test.executionLog)
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
    console.log('\nResults submitted to qTest',
      `\x1b[4mhttps://${qTestConfig.host}/p/${qTestConfig.projectId}/portal/project#tab=testexecution&object=2&id=${testSuiteId}\x1b[0m`)
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
