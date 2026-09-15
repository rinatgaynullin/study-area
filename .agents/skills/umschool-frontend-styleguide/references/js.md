# JavaScript

**1.** Избегайте сокращений в именах.

```javascript
// Плохо
const onItmClk = () => {};

// Хорошо
const onItemClick = () => {};
```

**2.** Используйте полное слово `event` для именования объектов DOM-событий.

```javascript
// Плохо
const onClick = (e) => { /* ... */ };
const onMousedown = (evt) => { /* ... */ };
const onMousedown = (eventObject) => { /* ... */ };

// Хорошо
const onScroll = (event) => { /* ... */ };
const clickEvent = new MouseEvent('click');
```

**3.** Используйте полное слово `error` для именования объектов ошибок.

```javascript
// Жесть...
const e = new Error();

try {
  throw new Error();
} catch (e) {
  alert(e);
}

// Коротковато
const err = new Error();

// Хорошо
const randomError = new Error();

try {
  throw randomError;

  // Хорошо
} catch (error) {
  alert(error);
}
```

**4.** Используйте `UPPER_SNAKE_CASE` для имен переменных, которые хранят значение известное еще
до выполнения кода (т.е. для констант).

> [!IMPORTANT]
> Правило не распространяется на ключи объектов.

```javascript
// Плохо
const secondsInMinute = 60;

// Плохо - правило не рапространяется на ключи константных объектов
const USER_TYPES = {
    ADMIN: 'aDmIn-23423',
    SUPER_MODERATOR: 'modeR-45528',
};

// Хорошо
const LENIN_BIRTHDAY = '22.04.1870';

// Хорошо
const USER_TYPES = Object.freeze({
    admin: 'aDmIn-23423',
    superModerator: 'modeR-45528',
});

// Хорошо - значение, вычисляемое в рантайме, константой НЕ является
const age = someCode(birthday);
```

**5.** Переменные, хранящие в себе предопределенные регулярные выражения, также считаются
константами в `UPPER_SNAKE_CASE`.

```javascript
const inputElement = document.querySelector('input');

inputElement.addEventListener('change', (e) => {
  // Плохо - регулярное выражение не константно, т.к. зависит от динамического значения
  const REGEX_FROM_INPUT_VALUE = new RegExp(e.value);
});

// Хорошо
const REGEX_PHONE = /\(?([0-9]{3})\)?([ .-]?)([0-9]{3})\2([0-9]{4})/;
const REGEX_HEX_COLOR = new RegExp('^#([a-fA-F0-9]){3}$|[a-fA-F0-9]{6}$');
```

**6.** Имена функций-обработчиков событий должны соответствовать шаблону
`on + контекст + глагол`, где контекст опционален.

> [!WARNING]
> Избегайте избыточного контекста ==> явно добавляйте его в имя обработчика только если он неочевиден из
контекста вызова (т.е. из имени компонента/класса/модуля, которому этот метод принадлежит).

```javascript
// Плохо
const handleInputChange = (e) => {};
const inputChangeHandler = (e) => {};

// Хорошо
const onInputChange = (e) => {};
```

**7.** Имена функций-предикатов (проверяющих какое-то условие/отвечающих на вопрос, т.е.
возвращающих логическое значение) и аналогичных свойств/переменных должны соответствовать шаблону
`глагол + контекст + определение`.

> [!TIP]
> Рекомендуемые глаголы: `is`, `has`, `can`, `need` или `needTo`, `should`.

```javascript
// Плохо
const userActive = (user) => true;

// Лучше, но не то - глагол должен стоять на первом месте
const userIsActive = (user) => true;
let formIsValid;

// Хорошо
let needToUpdateProfile;
let isUserATeacher;
const user = { isActive: false, hasLicense: true };
const isFormValid = (form) => true;
const canUserLogin = (user) => true;
const hasUserGotPermission = false;
const isStudentPermitted = true;
const isEachUserLoggedIn = (users) => false;
const isAnyUserActive = true;
```

**8.** Имена функций-действий должны соответствовать шаблону `глагол + контекст`.

> [!IMPORTANT]
> Возможны исключения вроде `arrayToObject`.

> [!TIP]
> |  Глагол  | Когда использовать                                                                                                                                                                                                                                                                                        |
> |:--------:|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
> |   add    | Добавить что-либо в группу. Как правило, используется в отношении добавления элементов в массив/ассоциативный массив ==> является противоположностью глагола remove                                                                                                                                      |
> |  create  | Создать что-либо “из ничего”. Например, создание пользователя.                                                                                                                                                                                                                                            |
> |  delete  | Перманентно удалить что-либо без возможности восстановления. Например, удаление пользователя из базы данных                                                                                                                                                                                               |
> |  fetch   | Получить данные по сети и записать их в какое-то свойство/переменную. Как правило, используется в именах Vuex-действий или методов компонентов, которые получают данные из backend API и записывают их в состояние                                                                                     |
> | generate | Тоже “создать”, но, в отличии от create, подразумевается "сгенерировать данные A на базе данных B". Например, сгенерировать предсказание будущего на основе введенного имени и даты рождения пользователя (я не придумал ничего лучше).                                                                   |
> |   get    | Получить значение                                                                                                                                                                                                                                                                                         |
> |   hide   | Скрыть UI-элемент                                                                                                                                                                                                                                                                                         |
> |  remove  | Удалить не перманентно - когда что-то после своего удаления продолжает существовать в другом месте. Как правило, используется в отношении удаления элементов из списка - например, удаление студента из курса (студента больше нет в массиве “студенты курса N”, но он продолжает существовать в системе) |
> |   set    | Безусловно присвоить переменной со значением A значение B                                                                                                                                                                                                                                                 |
> |   show   | Отобразить UI-элемент - например, модальное окно                                                                                                                                                                                                                                                          |
> |  toggle  | Изменить состояние чего-то (как правило, логического значения) на противоположное                                                                                                                                                                                                                         |
> |  update  | Пока не утверждено

**9.** Используйте шаблон именования `set + контекст + состояние (существительное)` для
функций, являющихся сеттерами логического свойства/переменной с шаблоном именования `is + контекст + определение (прилагательное)`.

```javascript
const modal = {
  isVisible: false,
  isUserActive: true,

  // Плохо
  setIsVisible(isVisible) {
    this.isVisible = isVisible;
  },

  // Плохо
  setUserActive(isUserActive) {
    this.isUserActive = isUserActive;
  },

  // Хорошо
  setVisibility(isVisible) {
    this.isVisible = isVisible;
  },

  // Хорошо
  setUserActivity(isUserActive) {
    this.isUserActive = isUserActive;
  },
};

// Хорошо
let isUserActive = true;
const setUserActivity = (value) => { isUserActive = value; };
```

**10.** Имена функций, совершающих http-запрос, должны начинаться с имени используемого
http-метода.

```javascript
// Плохо
const requestUserCreation = (user) => axios.post('/user', user);
const createUser = (user) => axios.post('/user', user);

// Хорошо
const getUser = () => axios.get('/user');
const postUser = (user) => axios.post('/user', user);
const putUser = (user) => axios.put('/user', user);
```

**11.** index-файлы должны использоваться только для реэкспорта. Не размещайте в них другой код.

```javascript [random-tool/index.ts]
// Плохо
function toolCode() {
  console.log(TOOL_CONSTANT);
}

export { toolCode as randomTool };

// Хорошо
export { randomTool } from './random-tool';
```

**12.** Именуйте сервисы в `camelCase` с постфиксом `Service`.

> [!WARNING]
> Правило не касается имен [http-сервисов](./architecture.md#http-service-naming)

```javascript
// Плохо
export const auth = { /* ... */ };
export const PushService = { /* ... */ };

// Хорошо
export const authService = { /* ... */ };
export const pushService = { /* ... */ };
```

**13.** Используйте множественное число в именах ассоциативных массивов хранящих однородные элементы.

```javascript
// Плохо
const OPTION = {
  drugs: { label: 'Здоровье', color: 'white' },
  alcohol: { label: 'Спорт', color: 'blue' },
};

// Хорошо
const OPTIONS = {
  drugs: { label: 'Здоровье', color: 'white' },
  alcohol: { label: 'Спорт', color: 'blue' },
};

// Хорошо
const apples = new Map(['green', 'red']);
```

**14.** Используйте синтаксис JSDoc для документирования кода.

**15.** Используйте английский язык в сообщениях пользовательских ошибок.

```javascript
const foo = () => {
  // Плохо
  throw new Error('Не удалось инициализировать сервис');

  // Хорошо
  throw new Error('Failed to initialize service');
};
```
