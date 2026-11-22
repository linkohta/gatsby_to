interface ITaskQueueNode<ValueType> {
  value: ValueType
  next?: ITaskQueueNode<ValueType>
  prev?: ITaskQueueNode<ValueType>
}

/**
 * 双方向連結リストで実装したタスクキュー
 */
export class TaskQueue<ValueType> {
  private head?: ITaskQueueNode<ValueType>
  private tail?: ITaskQueueNode<ValueType>;

  *[Symbol.iterator](): Iterator<ITaskQueueNode<ValueType>> {
    let currentHead = this.head
    while (currentHead) {
      yield currentHead
      currentHead = currentHead.next
    }
  }

  /**
   * 新しいタスクをリストの末尾に追加する
   * @param task キューに追加するタスク
   */
  enqueue(task: ValueType): void {
    const newNode: ITaskQueueNode<ValueType> = {
      value: task,
    }
    if (this.tail) {
      this.tail.next = newNode
      newNode.prev = this.tail
    } else {
      this.head = newNode
    }

    this.tail = newNode
  }

  /**
   * キューからタスクのノードを取り除く
   * @param taskNode 取り除くキューのノード
   */
  remove(taskNode: ITaskQueueNode<ValueType>): void {
    if (taskNode === this.head) {
      this.head = taskNode.next
      if (this.head) {
        this.head.prev = undefined
      } else {
        // head がなければ、tail もない
        this.tail = undefined
      }
    } else {
      if (taskNode === this.tail) {
        this.tail = taskNode.prev
      } else {
        // ノードが tail でなければ、.next を持つ
        taskNode.next!.prev = taskNode.prev
      }
      // ノードが head でなければ、.prev を持つ
      taskNode.prev!.next = taskNode.next
    }
  }
}
