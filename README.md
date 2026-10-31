Bienvenidos al Segundo Proyecto de la catedra "Sistemas Distribuidos"

primer paso

ejecutar docker compose -f compose-servidor-emqx.yaml up para cargar todo
(revisar como poner el -d)

luego si queres ver el dashboard ejecuta
http/localhost:18083/

usuario admin
contraseña public

luego presionar skip


si deseas ver la bd desde el panel de phpmyadmin, ejecutar:
http/localhost:8080/

en server colocar: mysql
en usuario: usuario
en contraseña: usuario123


ignorar lo de abajo
Crear las siguientes carpetas si usas linux
///opt/emqx/data
///opt/emqx/etc

asi de esta forma el broker emqx puede guardar informacion de forma persistente en un volumen.


//sudo chown -R 1000:1000 /home/user/emqx/etc
//sudo chown -R 1000:1000 /home/user/emqx/data


