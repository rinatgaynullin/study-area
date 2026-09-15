# TypeScript

> [!NOTE]
> Гайд сформирован на базе руководства по стилю Google.

**1.** Не дополняйте имена чего-либо избыточной низкоуровневой информацией
о типе данных, которая уже включена в TS-тип.

**Почему:**
Современные IDE предоставляют информацию о природе и составе типа при наведении курсора, явное дополнение имени
специальным обозначением - избыточно.

```typescript
// Плохо - нет смысла явно информировать в имени, что это тип TypeScript
type UmitReactionValueType = 1 | -1;

// Плохо - мы не используем специальных префиксов в именах интерфейсов
interface ILesson {
  id: number,
  type: 'webinar' | 'individual',
};

// Плохо - сам модификатор доступа private УЖЕ говорит о доступности свойства
class MySafe {
  private _secretKey = 12345;
}

// Хорошо
type UmitReactionValue = 1 | -1;

/*
* Тут ок - слово "type" используется не в контексте TypeScript,
* а в значении "характеристика сущности урока в системе"
* */
type LessonType = 'webinar' | 'individual';
```

**2.** Объединения, выражающие конкретную абстракцию (например: тип урока, статус ДЗ, день
недели, порода собаки), не должны включать в себя `null` или `undefined`. Вместо этого, литерально добавляйте
эти типы в объединение в месте фактического использования псевдонима.

Иначе говоря, рекомендуется работать с `null` и `undefined` как с типами в непосредственной близости к месту
возникновения этих значений.

```typescript
// Плохо
type Coffee = Latte | Americano | undefined;

class CoffeeService {
  getLatte(): Coffee { /* ... */  };
}
```

```typescript
// Хорошо
type Coffee = Latte | Americano;

class CoffeeService {
  getLatte(): Coffee | undefined { /* ... */ };
}
```

**3.** Используйте опциональные свойства (`?`) вместо явной аннотации `undefined` всегда,
когда это возможно.

```typescript
// Хорошо
interface CoffeeOrder {
  sugarCubes: number;
  milk?: Whole | LowFat | HalfHalf;
}

// Хорошо
function pourCoffee(volume?: Milliliter) { /* ... */ }
```

**4.** Используйте интерфейсы (`interface`) вместо псевдонимов типов (`type`) всегда, когда
это технически возможно.

**Почему:**
Эти формы почти эквивалентны, и предлагаемое правило - самый простой способ регламентировать их использование.
Кроме того, по словам руководителя команды разработчиков TypeScript:

> Честно говоря, я считаю, что необходимо использовать интерфейсы для всего, что они могут смоделировать. Нет смысла
> использовать псевдонимы, когда с их выводом и производительностью связано столько проблем.

```typescript
// Плохо
type User = {
  firstName: string,
  lastName: string,
};

// Хорошо
interface User {
  firstName: string;
  lastName: string;
  role: UserRole;
}

// Реализуемо только с использованием псевдонима типа
type UserRole = 'student' | 'teacher';
```

**5.** Для простых типов массивов используйте сокращенную запись `T[]`. Для чего-то более сложного
используйте полную форму `Array<T>`.

```typescript
// Плохо
const f: Array<string>;
const g: ReadonlyArray<string>;
const h: { n: number, s: string }[];
const i: (string|number)[];
const j: readonly (string|number)[];

// Хорошо
const a: string[];
const b: readonly string[];
const c: ns.MyObj[];
const d: Array<string|number>;
const e: ReadonlyArray<string|number>;
```

**6.** Старайтесь не злоупотреблять утилитарными типами (`Record`, `Partial`, `Readonly` и др.),
если это очевидно затрудняет чтение кода.

Часто эти механизмы TypeScript позволяют лаконично задавать типы и создавать мощные, но в то же время безопасные
абстракции типов. Однако они обладают и недостатками.

Общая рекомендация такова:
- Всегда используйте самую простую конструкцию типа, которая позволяет выразить ваш код;
- Небольшое количество повторений или многословность зачастую обходятся дешевле, чем долговременные затраты на сложные
  выражения объявления типов;
- При соблюдении перечисленных условий, использование сопоставленных и условных типов допустимо.

```typescript
/*
* Например, встроенный в TypeScript тип Pick<T, Keys> позволяет создать новый тип на основе
* подмножества другого типа T, но простое расширение интерфейса часто может быть проще для
* понимания
* */

interface User {
  shoeSize: number;
  favoriteIcecream: string;
  favoriteChocolate: string;
}

// Плохо
type FoodPreferences = Pick<User, 'favoriteIcecream' | 'favoriteChocolate'>;

// Хорошо - во избежание дублирования User может просто расширить FoodPreferences
interface FoodPreferences {
  favoriteIcecream: string;
  favoriteChocolate: string;
}

// Хорошо
interface User extends FoodPreferences {
  shoeSize: number;
}
```

**7.** Избегайте использования явного утверждения типа (`x as SomeType`) и утверждения ненулевого
значения (`y!`) без веской причины.

**Почему:**
Оба механизма только заглушают компилятор TypeScript, но не добавляют никаких проверок на соответствие этим утверждениям
в рантайме, ввиду чего они могут привести к сбою вашего кода во время выполнения. Вместо этого, лучше напишите проверку,
которая работает в рантайме.

```typescript
// Плохо
(x as Foo).foo();

// Плохо
y!.bar();

// Хорошо
if (x instanceof Foo) {
  x.foo();
}

// Хорошо
if (y) {
  y.bar();
}
```

**8.** Если вам действительно понадобилось явное утверждение типа, используйте синтаксис `as`
вместо угловых скобок.

**Почему:**
Это позволяет заключить утверждение в круглые скобки при обращении к свойству.

```typescript
// Плохо
const x = (<Foo>z).length;
const y = <Foo>z.length;

// Хорошо
const x = (z as Foo).length;
```

**9.** Используйте единственное число в именах перечислений.

```typescript
// Плохо
enum Directions {
  Up = 'UP',
  Down = 'DOWN',
}

// Хорошо
enum Direction {
  Up = "UP",
  Down = "DOWN",
}
```

**10.** Используйте низкоуровневые слова `Request`, `Response`, `ResponseBody`.
`RequestBody`, `RequestQueryParameters` и т.п. в именах типов функций, совершающих http-запросы, для явного уточнения
сути этих типов.

```typescript
interface User {
  name: 'Pierre Dunn'
}

// Плохо - это имя функции, а не возвращаемого типа
interface GetUser {
  user: User
}

// Плохо - интерфейс является телом ответа http-запроса, а не полным объектом ответа
interface GetUserResponse {
  user: User
}

// Хорошо
interface GetUserPayload {
  id: number,
}

// Хорошо
interface GetUserResponseBody {
  user: User
}

const getUser = ({ id }: GetUserPayload) => GetUserResponseBody;

```
