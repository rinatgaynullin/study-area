from django.db import models

from rich_editor.fields import RichTextField


class Article(models.Model):
    body = RichTextField(blank=True)
    old_body = RichTextField(blank=True, legacy=True)
