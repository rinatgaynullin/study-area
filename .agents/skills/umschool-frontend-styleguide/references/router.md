# Router

**1.** Имя (`name`) роута должно соответствовать имени своего компонента-представления в `PascalCase`.

```javascript
const routes = [
  {
    // Плохо - имя роута не соответствует имени компонента-представления
    name: 'profile',
    component: UserProfile,
    path: '/profile',
  },

  {
    // Плохо - нужен PascalСase
    name: 'userCart',
    component: UserCart,
    path: '/cart',
  },

  {
    // Хорошо
    name: 'ProductPayment',
    component: ProductPayment,
    path: '/payment',
  },
];
```

**2.** Используйте `name` роута вместо `path` везде, где это возможно.

**Почему:**
Путь роута сильно зависит от бизнеса и может измениться в любой момент, в то время как его имя существует только в
плоскости разработки изменяется редко.

```javascript
const routes = [
  {
    name: 'SuperSale',
    path: '/super-sale',
    component: SuperSale,
  },
];

// Плохо
router.push({ path: '/super-sale' });

// Хорошо
router.push({ name: 'SuperSale' });
```

**3.** Используйте стиль написания `PascalCase` для значения параметра `name`компонента
`RouterView`.

```vue
<!-- Плохо -->
<RouterView name="left-sidebar" />
<RouterView name="leftSidebar" />

<!-- Хорошо -->
<RouterView name="LeftSidebar" />
```
