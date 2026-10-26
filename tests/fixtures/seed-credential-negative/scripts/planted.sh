# #3281 negative-control fixture — a shell credential and a request-body password.
SEC_LOGIN_PASSWORD="ShellDefault7!"
curl -s -d '{"email":"a@b.c","password":"BodyLiteral9!"}' http://localhost:3000/api/auth/login
