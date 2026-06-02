interface User {
  name: string
  age: number
}

export function createUsers(): User[] {
  return [
    { name: 'Alice', age: 28 },
    { name: 'Bob', age: 34 },
    { name: 'Charlie', age: 22 },
  ]
}

const adults = createUsers().filter((u) => u.age >= 25)
console.log('Adults:', adults)
