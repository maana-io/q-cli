set -e
# gql maddsvc "cli.test09" -i "cli.test09" -s "09/model.gql" -p ckg
# gql get-schema -p test09
# gql mload "09/data" -p test09
# gql mload "09/data/movie_actors.csv" -p test09 -b 1000
gql mload "09/data/user_taggedmovies.csv" -p test09