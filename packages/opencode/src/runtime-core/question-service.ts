import { Question } from "../question"

export class QuestionRuntimeService {
  static async list() {
    return Question.list()
  }

  static async reply(input: { requestID: string; answers: string[][] }) {
    await Question.reply(input)
    return true
  }

  static async reject(requestID: string) {
    await Question.reject(requestID)
    return true
  }
}
