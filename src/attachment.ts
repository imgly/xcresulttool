import {Activity} from './activity'
import {Dimensions} from './dimensions'
import {Parser} from './parser'

import {Reference} from '../dev/@types/Reference.d'
import {SortedKeyValueArray} from '../dev/@types/SortedKeyValueArray.d'

export interface Attachment {
  uniformTypeIdentifier: string
  name?: string
  uuid?: string
  timestamp?: string
  userInfo?: SortedKeyValueArray
  lifetime: string
  inActivityIdentifier: number
  filename?: string
  payloadRef?: Reference
  payloadSize: number
  link: string
  dimensions: Dimensions
}

export async function exportAttachments(
  parser: Parser,
  activity: Activity
): Promise<void> {
  activity.attachments = activity.attachments || []
}
