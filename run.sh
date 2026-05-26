./grammar/compile.sh
node tricz.mjs test/$1.tricz -o test/$1.zez ${@:2}
for file in *.dot; do
    dot $file -Tsvg > $file.svg
done