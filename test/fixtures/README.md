`fixture-display.woff2` is Bebas Neue (Dharma Type, SIL Open Font License 1.1), subset to printable ASCII with
`python -m fontTools.subset BebasNeue-Regular.ttf --unicodes=U+0020-007E --flavor=woff2`. The tests serve it as the
web font "Fixture UI" so they can check that the CLI reports a font that really loaded.
