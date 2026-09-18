SECRET_KEY = 'tests'
DEBUG = True
ROOT_URLCONF = 'tests.urls'
INSTALLED_APPS = [
    'django.contrib.contenttypes',
    'django.contrib.auth',
    'django.contrib.sessions',
    'django.contrib.staticfiles',
    'rich_editor',
    'tests',
]
MIDDLEWARE = [
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
]
DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}}
TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'APP_DIRS': True,
        'OPTIONS': {'context_processors': []},
    },
]
STATIC_URL = '/static/'
MEDIA_URL = '/media/'
USE_I18N = True
LANGUAGE_CODE = 'ru'
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
