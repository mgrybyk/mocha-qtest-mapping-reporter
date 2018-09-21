const request = require('sync-request')

class qTestClient {
  constructor (host, bearerToken, projectId) {
    this.baseUrl = `https://${host}/api/v3`
    this.projectUrl = `${this.baseUrl}/projects/${projectId}`

    this.options = {
      headers: {
        'Host': host,
        'Authorization': `bearer ${bearerToken}`,
        'Cache-Control': 'no-cache'
      }
    }
  }

  getSuiteTestRuns (testSuite) {
    const url = `${this.projectUrl}/test-runs`

    // request
    const errorMessage = 'qTestReporter: failed to getSuiteTestRuns.'
    let res
    try {
      res = request('GET', url, {
        ...this.options,
        qs: {
          parentId: testSuite,
          parentType: 'test-suite',
          page: 1,
          pageSize: 999
        }
      })
    } catch (err) {
      console.error(errorMessage)
      throw err
    }

    // parse response body
    let body = parseBody(res, errorMessage)

    // mapping
    const mapping = {}
    body.items.forEach(testRun => {
      mapping[testRun.test_case.id] = { id: testRun.id, name: testRun.name }
    })

    return mapping
  }

  getTestCase (testCaseId) {
    const url = `${this.projectUrl}/test-cases/${testCaseId}`

    // request
    const errorMessage = 'qTestReporter: failed to getTestCase.'
    let res
    try {
      res = request('GET', url, { ...this.options })
    } catch (err) {
      console.error(errorMessage)
      throw err
    }

    // parse response body
    let resBody = null
    try {
      resBody = parseBody(res)
      if (!resBody.id) {
        console.error(errorMessage, '\nERROR:', resBody.message)
        resBody = null
      }
    } catch (err) { }
    return resBody
  }

  postLog (testRunId, body) {
    const url = `${this.projectUrl}/test-runs/${testRunId}/auto-test-logs`

    // request
    const errorMessage = 'qTestReporter: Failed to post test log.'
    let res
    try {
      res = request('POST', url, {
        ...this.options,
        json: body
      })
    } catch (err) {
      console.error(errorMessage, body)
      throw err
    }

    // parse response body
    try {
      const resBody = parseBody(res)
      if (!resBody.id) {
        console.error(errorMessage, '\nERROR:', resBody.message, body)
      }
    } catch (err) { }
  }

  createTestSuite (parentType, parentId, name) {
    const url = `${this.projectUrl}/test-suites`

    // request
    const errorMessage = 'qTestReporter: Failed to create test suite.'
    let res
    try {
      res = request('POST', url, {
        ...this.options,
        json: { parentId, parentType, name },
        qs: { parentId, parentType }
      })
    } catch (err) {
      console.error(errorMessage)
      throw err
    }

    // parse response body
    const resBody = parseBody(res)
    if (!resBody.id) {
      console.error(errorMessage, '\nERROR:', resBody.message)
      throw new Error(errorMessage)
    }
    return resBody.id
  }

  createTestRun (testSuiteId, testCaseId) {
    const testCase = this.getTestCase(testCaseId)
    if (!testCase) return

    const url = `${this.projectUrl}/test-runs`

    // request
    const errorMessage = 'qTestReporter: Failed to craete test run.'
    let res
    try {
      res = request('POST', url, {
        ...this.options,
        json: {
          parentId: testSuiteId,
          parentType: 'test-suite',
          name: testCase.name,
          test_case: { id: testCaseId }
        },
        qs: { parentId: testSuiteId, parentType: 'test-suite' }
      })
    } catch (err) {
      console.error(errorMessage)
      throw err
    }

    // parse response body
    const resBody = parseBody(res)
    if (!resBody.id) {
      console.error(errorMessage, resBody.message)
      throw new Error(errorMessage)
    }
    return {
      id: resBody.id,
      name: resBody.name
    }
  }
}

function parseBody (res, errorMessage) {
  let body = res.body.toString()
  try {
    if (body) return JSON.parse(body)
    else throw new Error('no body found in respose')
  } catch (err) {
    console.error(errorMessage, `\nStatus code: ${res.statusCode}\n`, body, '\n')
    throw err
  }
}

module.exports = qTestClient
