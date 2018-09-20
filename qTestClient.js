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
      console.error('qTestReporter: failed to getSuiteTestRuns')
      throw err
    }

    // parse response body
    let body = parseBody(res, 'qTestReporter: failed to getSuiteTestRuns.')

    // mapping
    const mapping = {}
    body.items.forEach(testRun => {
      mapping[testRun.test_case.id] = { id: testRun.id, name: testRun.name }
    })

    return mapping
  }

  postLog (testRunId, body) {
    const url = `${this.projectUrl}/test-runs/${testRunId}/auto-test-logs`

    // request
    const errorMessage = 'qTestReporter: Failed to post test log'
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
        console.error(errorMessage, resBody.message, body)
      }
    } catch (err) { }
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
