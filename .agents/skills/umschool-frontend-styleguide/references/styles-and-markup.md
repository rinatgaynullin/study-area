# Стили и разметка

**1.** Все CSS-классы должны соответствовать стилю написания `kebab-case`.

**2.** Не задавайте в компоненте стили корневого элемента, определяющие его положение относительно родителя или соседних элементов.

### Плохо

Компонент сам задаёт внешний отступ, поэтому он появится во всех местах использования `UserCard`:

```vue [user-card.vue]
<template>
  <!-- Внешнее позиционирование (margin-bottom) зашито в компонент -->
  <article class="bg-purple p-4 mb-4">
    ...
  </article>
</template>
```

```vue [users-list.vue]
<template>
  <div>
    <UserCard />
    <UserCard />
  </div>
</template>
```

### Хорошо

`UserCard` отвечает только за внутреннюю раскладку, а расстояние между карточками задаёт `UsersList`:

```vue [user-card.vue]
<template>
  <article class="bg-purple p-4">
    ...
  </article>
</template>
```

```vue [users-list.vue]
<template>
  <!-- Родитель управляет расположением дочерних компонентов -->
  <div class="grid gap-y-4">
    <UserCard />
    <UserCard />
  </div>
</template>
```
