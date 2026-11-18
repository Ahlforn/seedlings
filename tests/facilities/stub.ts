/** A stand-in for fetchJson: answers by the first key found in the URL; an Error is thrown; no key is a 404. */
export function stub(answers: Record<string, unknown>) {
  const asked: string[] = []
  const fetchJson = async (url: string) => {
    asked.push(url)
    const key = Object.keys(answers).find((k) => url.includes(k))
    if (key === undefined) throw new Error(`${url} answered 404`)
    const answer = answers[key]
    if (answer instanceof Error) throw answer
    return answer
  }
  return Object.assign(fetchJson, { asked })
}
