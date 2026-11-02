/**
 * Public background in drafting (2026-11-02, review round 1): names of
 * well-known public technologies, methods, standards and bodies that a web
 * search may carry. A word that reads like a name in the project's own
 * sources (capitalised mid-sentence and never written in lower case, or
 * joined like "ZephyrForge") may leave Banhall only when it is listed here,
 * so a product, customer or code name that only the sources hold is never
 * searched. Lower case, one word each (the guard splits on anything that is
 * not a letter or a digit). Add a term only when it names something public.
 */
export const PUBLIC_TECH_TERMS: ReadonlySet<string> = new Set(
  `
  canada canadian cra sred t661 t4088 oecd frascati iso iec ieee astm csa ul ansi nist din en asme api sae
  python java javascript typescript kotlin swift rust go golang c cpp csharp dotnet net ruby php perl scala haskell erlang elixir julia fortran cobol matlab simulink labview r sql nosql graphql grpc rest soap json xml yaml html css wasm webassembly
  react angular vue svelte sveltekit nextjs nuxt node nodejs deno bun express django flask fastapi rails laravel spring springboot hibernate unity unreal godot qt gtk electron flutter xamarin
  linux unix windows android ios macos ubuntu debian centos redhat rhel freertos zephyr rtos yocto posix
  docker kubernetes k8s helm terraform ansible puppet chef jenkins github gitlab bitbucket git circleci argo argocd prometheus grafana kibana logstash elasticsearch opensearch splunk datadog
  postgresql postgres mysql mariadb sqlite oracle mssql mongodb cassandra redis memcached dynamodb cosmosdb couchdb neo4j influxdb timescaledb clickhouse snowflake bigquery redshift databricks
  kafka rabbitmq mqtt amqp zeromq nats pulsar kinesis spark hadoop hive flink airflow dbt beam pandas numpy scipy polars
  aws azure gcp lambda ec2 s3 rds ecs eks fargate cloudflare vercel heroku openstack vmware hyperv kvm
  tensorflow pytorch keras jax onnx tflite tensorrt openvino cuda opencl openmp mpi scikit sklearn xgboost lightgbm catboost huggingface transformers bert gpt llm lora yolo resnet unet lstm gru cnn rnn gan vae rag
  opencv pcl ros ros2 gazebo moveit slam lidar radar sonar gps gnss imu rtk
  selenium playwright puppeteer cypress jest pytest junit
  oauth openid saml jwt tls ssl https http http2 http3 quic tcp udp ip ipv4 ipv6 dns dhcp vpn wireguard ipsec ssh ftp sftp smtp bgp ospf vlan sdn nfv 5g 4g lte nbiot lorawan lora zigbee zwave bluetooth ble wifi nfc rfid uwb thread matter modbus profinet profibus ethercat canbus can opcua opc bacnet hart
  rnd m0 m3 m4 m7 m33 m55 a53 a72
  arm cortex risc riscv x86 amd intel nvidia jetson qualcomm snapdragon xilinx altera fpga asic soc mcu dsp gpu tpu npu stm32 esp32 nrf52 raspberry arduino beaglebone
  plc scada hmi dcs mes erp crm cad cam cae cfd fea bim gis plm
  solidworks autocad inventor catia creo nx fusion revit ansys comsol abaqus openfoam fluent lsdyna hypermesh
  cnc edm tig mig gmaw gtaw smaw fcaw saw laser additive sls sla fdm dmls slm ebm hvac ups
  kalman ransac fourier fft laplace bayesian bayes gaussian markov monte carlo dijkstra newton euler lagrange hough canny sobel levenberg marquardt pid mpc lqr nyquist shannon huffman lempel ziv viterbi
  pvc pla abs petg nylon peek ptfe teflon kevlar inconel titanium aluminium aluminum hdpe ldpe epoxy
  `
    .split(/\s+/u)
    .filter(Boolean)
);
