#!/bin/bash

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' 

serviceName="$1"
servicePath="$2"
registryPath="$3"
version="$4"
replicas="$5"
port="$6"
interval=5
max_attempts=100


tag=$registryPath/$serviceName:$version    
  
function __is_deployment_available() {
  [[ "$(kubectl get deployment "$serviceName" -o 'jsonpath={.status.conditions[?(@.type=="Available")].status}')" == 'True' ]]
}

function __is_ingress_ready() {
  [[ "$(kubectl get service "$serviceName" -o 'jsonpath={.status.loadBalancer.ingress[].ip}')" != '' ]]
}  

printf "===========================================\n"

if [[ "$(kubectl get deployment "$serviceName" -o 'jsonpath={.status.conditions[?(@.type=="Available")].status}')" == 'True' ]];then    
  printf "${RED}Deleteing outdated deployment${NC} $serviceName${NC}\n"    
  kubectl delete deployment $serviceName
fi

# kubectl get deployment "$serviceName" -o 'jsonpath={.status.conditions[?(@.type=="Available")].status}'
printf "===========================================\n"
printf "${BLUE}Deploying${NC} $serviceName with ${replicas} pods\n"
kubectl run $serviceName --image=$tag --port=$port --replicas=$replicas

pod_ready_attempt_counter=0
until __is_deployment_available; do
    if [ ${pod_ready_attempt_counter} -eq ${max_attempts} ];then
      echo "Max attempts reached"
      exit 1
    fi

    printf '.'
    attempt_counter=$(($attempt_counter+1))
    sleep $interval
done  
printf "\n${GREEN}Done deploying${NC} $serviceName:$version${NC}\n"

printf "===========================================\n"
printf "${BLUE}Exposing${NC} $serviceName:$version${NC}\n"

kubectl expose deployment $serviceName --type=LoadBalancer --port=$port --target-port=$port  

printf "Waiting for an IP address for ${GREEN}$serviceName:$version${NC}\n\n"

deployment_ready_attempt_counter=0
until __is_ingress_ready; do
    if [ ${deployment_ready_attempt_counter} -eq ${max_attempts} ];then
      echo "Max attempts reached"
      exit 1
    fi

    printf '.'
    attempt_counter=$(($attempt_counter+1))
    sleep $interval
done

ip=`kubectl get service $serviceName -o json -o 'jsonpath={.status.loadBalancer.ingress[].ip}'`  

printf "===========================================\n\n"
printf "The external IP address for ${BLUE}$serviceName:$version${NC} is:\n\n ${GREEN}$ip${NC}\n\n"
printf "The URL for your GraphQL endpoint is\n\n  ${GREEN}http://$ip:$port/graphql\n\n${NC}"  
