const request = require('request-promise-native')

class qTestClient {
  constructor (host, bearerToken, projectId) {
    this.baseUrl = `https://${host}/api/v3`
    this.projectUrl = `${this.baseUrl}/projects/${projectId}`

    this.options = {
      headers: {
        'Host': host,
        'Authorization': `bearer ${bearerToken}`,
        'Cache-Control': 'no-cache'
      },
      resolveWithFullResponse: true
    }
  }

  async getSuiteTestRuns (testSuite) {
    const url = `${this.projectUrl}/test-runs`

    // request
    const errorMessage = 'qTestReporter: failed to getSuiteTestRuns.'
    const res = await request(Object.assign({}, this.options, {
      method: 'GET',
      uri: url,
      qs: {
        parentId: testSuite,
        parentType: 'test-suite',
        page: 1,
        pageSize: 999
      }
    }))

    // parse response body
    let body = parseBody(res, errorMessage)

    // mapping
    const mapping = {}
    body.items.forEach(testRun => {
      mapping[testRun.test_case.id] = { id: testRun.id, name: testRun.name }
    })

    return mapping
  }

  async getTestCase (testCaseId) {
    const url = `${this.projectUrl}/test-cases/${testCaseId}`

    // request
    const errorMessage = 'qTestReporter: failed to getTestCase.'
    let res
    try {
      res = await request(Object.assign({}, this.options, {
        method: 'GET',
        uri: url
      }))
    } catch (err) {
      return console.error(errorMessage, testCaseId)
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

  async postLog (testRunId, body) {
    const url = `${this.projectUrl}/test-runs/${testRunId}/auto-test-logs`

    // request
    const errorMessage = 'qTestReporter: Failed to post test log.'
    let res
    try {
      res = await request(Object.assign({}, this.options, {
        method: 'POST',
        uri: url,
        json: true,
        body
      }))
    } catch (err) {
      return console.error(errorMessage, err.message, body)
    }

    // parse response body
    if (!res.body || !res.body.id) {
      console.error(errorMessage, '\nERROR:', res.body, body)
    }
  }

  async createTestSuite (parentType, parentId, name) {
    const url = `${this.projectUrl}/test-suites`

    // request
    const errorMessage = 'qTestReporter: Failed to create test suite.'
    let res = await request(Object.assign({}, this.options, {
      method: 'POST',
      uri: url,
      json: true,
      body: { parentId, parentType, name },
      qs: { parentId, parentType }
    }))

    // parse response body
    if (!res.body || !res.body.id) {
      console.error('ERROR:', res.body)
      throw new Error(errorMessage)
    }
    return res.body.id
  }

  async createTestRun (testSuiteId, testCaseId) {
    const testCase = await this.getTestCase(testCaseId)
    if (!testCase) return

    const url = `${this.projectUrl}/test-runs`

    // request
    const errorMessage = 'qTestReporter: Failed to create test run.'
    let res
    try {
      res = await request(Object.assign({}, this.options, {
        method: 'POST',
        uri: url,
        json: true,
        body: {
          parentId: testSuiteId,
          parentType: 'test-suite',
          name: testCase.name,
          test_case: { id: testCaseId }
        },
        qs: { parentId: testSuiteId, parentType: 'test-suite' }
      }))
    } catch (err) {
      return console.error(errorMessage)
    }

    // parse response body
    if (!res.body || !res.body.id) {
      console.error(errorMessage, res.body)
      return null
    }
    return res.body
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
