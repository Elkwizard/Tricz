set -e
./grammar/compile.sh
node tricz.mjs test/$1.tricz -o test/$1.zez
if [ $2 == run ]; then
    zez run test/$1.zez ${@:3}
fi
for file in *.dot; do
    dot $file -Tsvg > $file.svg
done